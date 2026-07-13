import Darwin
import Foundation

private let supportedSchemaVersion = 1
private let supportedBundleIdentifier = "com.luma.wallpaper"
private let parentExitTimeout: TimeInterval = 60

private enum HelperError: LocalizedError {
    case invalidPlan(String)
    case fileSystem(String)
    case command(String)
    case timeout(String)

    var errorDescription: String? {
        switch self {
        case .invalidPlan(let message), .fileSystem(let message), .command(let message), .timeout(let message):
            return message
        }
    }
}

private struct UpdatePlan: Decodable {
    let schemaVersion: Int
    let oldPid: Int32
    let currentApp: String
    let candidateApp: String
    let healthMarker: String
    let journalFile: String
    let logFile: String
    let timeoutSeconds: Double
    let token: String
    let expectedBundleId: String
    let expectedVersion: String
}

private struct HealthMarker: Decodable {
    let token: String
    let bundleId: String
    let version: String
}

private struct JournalRecord: Encodable {
    let schemaVersion = supportedSchemaVersion
    let state: String
    let updatedAt: String
    let token: String
    let currentApp: String
    let candidateApp: String
    let expectedVersion: String
    let message: String?
}

private final class SecureLogger {
    private let descriptor: Int32

    init(path: String) throws {
        let parent = URL(fileURLWithPath: path).deletingLastPathComponent().path
        try requireSecureWritableDirectory(parent, label: "log parent")

        descriptor = path.withCString {
            Darwin.open($0, O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
        }
        guard descriptor >= 0 else {
            throw HelperError.fileSystem("Unable to open update log: \(lastPOSIXError())")
        }
        _ = Darwin.fchmod(descriptor, S_IRUSR | S_IWUSR)
    }

    deinit {
        Darwin.close(descriptor)
    }

    func write(_ message: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let data = Data("[\(timestamp)] \(message)\n".utf8)
        data.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return }
            var written = 0
            while written < bytes.count {
                let result = Darwin.write(descriptor, baseAddress.advanced(by: written), bytes.count - written)
                if result <= 0 { return }
                written += result
            }
        }
        _ = Darwin.fsync(descriptor)
    }
}

private final class UpdateHelper {
    private let plan: UpdatePlan
    private let planPath: String
    private let logger: SecureLogger
    private var hasSwapped = false
    private var parentExited = false

    init(plan: UpdatePlan, planPath: String) throws {
        self.plan = plan
        self.planPath = planPath
        self.logger = try SecureLogger(path: plan.logFile)
    }

    func run() throws {
        do {
            try validatePlan(plan)
            try writeJournal(state: "validated", message: nil)
            logger.write("Validated update plan for \(plan.expectedVersion).")

            try removeStaleHealthMarker()
            try writeJournal(state: "waiting-for-parent", message: nil)
            logger.write("Waiting for parent PID \(plan.oldPid) to exit.")
            guard waitForProcessExit(pid: pid_t(plan.oldPid), timeout: parentExitTimeout) else {
                throw HelperError.timeout("The running app did not exit within \(Int(parentExitTimeout)) seconds.")
            }
            parentExited = true

            try validateAppBundle(path: plan.currentApp, expectedVersion: nil)
            try validateAppBundle(path: plan.candidateApp, expectedVersion: plan.expectedVersion)
            try runCommand(executable: "/usr/bin/codesign", arguments: ["--verify", "--deep", "--strict", plan.candidateApp])
            try atomicSwap(plan.currentApp, plan.candidateApp)
            hasSwapped = true
            writeJournalBestEffort(state: "swapped", message: nil)
            logger.write("Atomically swapped the current and candidate app bundles.")

            try launchCandidate()
            writeJournalBestEffort(state: "launched-candidate", message: nil)
            logger.write("Launched the candidate and started the health-check timer.")

            if try waitForHealthyCandidate(timeout: plan.timeoutSeconds) {
                // A matching marker is the commit point. Cleanup must never turn a
                // successful launch into a rollback, including when the journal
                // cannot be written because the disk is full.
                hasSwapped = false
                writeJournalBestEffort(state: "healthy", message: nil)
                logger.write("Candidate reported a valid health marker; update completed.")
                cleanupTransientArtifacts(removeCandidate: true)
                return
            }

            throw HelperError.timeout("The updated app did not become healthy within \(Int(plan.timeoutSeconds)) seconds.")
        } catch {
            logger.write("Update failed: \(error.localizedDescription)")
            if hasSwapped {
                do {
                    try rollback(reason: error.localizedDescription)
                } catch let rollbackError {
                    try? writeJournal(
                        state: "rollback-failed",
                        message: "\(error.localizedDescription); rollback failed: \(rollbackError.localizedDescription)"
                    )
                    logger.write("Rollback failed: \(rollbackError.localizedDescription)")
                    throw HelperError.fileSystem(
                        "Update failed and rollback was unsuccessful: \(rollbackError.localizedDescription)"
                    )
                }
            } else {
                try? writeJournal(state: "failed", message: error.localizedDescription)
                if parentExited {
                    reopenCurrentAppAfterPreSwapFailure()
                }
                cleanupTransientArtifacts(removeCandidate: true)
            }
            throw error
        }
    }

    private func reopenCurrentAppAfterPreSwapFailure() {
        do {
            try validateAppBundle(path: plan.currentApp, expectedVersion: nil)
            try launchRecoveredCurrentApp()
            logger.write("Relaunched the unchanged app after a pre-swap update failure.")
            try? writeJournal(
                state: "failed-current-relaunched",
                message: "The update failed before the app bundles were swapped."
            )
        } catch {
            logger.write("Could not relaunch the unchanged app after update failure: \(error.localizedDescription)")
            try? writeJournal(
                state: "failed-current-relaunch-failed",
                message: error.localizedDescription
            )
        }
    }

    private func removeStaleHealthMarker() throws {
        let markerPath = plan.healthMarker
        guard FileManager.default.fileExists(atPath: markerPath) else { return }
        let status = try statusForPath(markerPath, followSymlinks: false)
        guard isRegularFile(status) else {
            throw HelperError.fileSystem("Health marker path is not a regular file.")
        }
        guard status.st_uid == geteuid() else {
            throw HelperError.fileSystem("Health marker is not owned by the current user.")
        }
        try FileManager.default.removeItem(atPath: markerPath)
    }

    private func launchCandidate() throws {
        try runCommand(
            executable: "/usr/bin/open",
            arguments: [
                "-n",
                plan.currentApp,
                "--args",
                "--luma-update-health-marker",
                plan.healthMarker,
                "--luma-update-token",
                plan.token,
            ]
        )
    }

    private func waitForHealthyCandidate(timeout: TimeInterval) throws -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if FileManager.default.fileExists(atPath: plan.healthMarker) {
                let markerStatus = try statusForPath(plan.healthMarker, followSymlinks: false)
                guard isRegularFile(markerStatus), markerStatus.st_uid == geteuid(), markerStatus.st_mode & 0o022 == 0 else {
                    throw HelperError.fileSystem("Health marker failed ownership or permission validation.")
                }

                do {
                    let data = try Data(contentsOf: URL(fileURLWithPath: plan.healthMarker), options: .mappedIfSafe)
                    let marker = try JSONDecoder().decode(HealthMarker.self, from: data)
                    if marker.token == plan.token,
                       marker.bundleId == plan.expectedBundleId,
                       marker.version == plan.expectedVersion
                    {
                        return true
                    }
                } catch {
                    // The app writes the marker atomically, but tolerate a short visibility race.
                }
            }
            usleep(100_000)
        }
        return false
    }

    private func rollback(reason: String) throws {
        writeJournalBestEffort(state: "rolling-back", message: reason)
        logger.write("Stopping the candidate before rollback.")
        terminateCandidateProcesses()

        try atomicSwap(plan.currentApp, plan.candidateApp)
        hasSwapped = false
        try validateAppBundle(path: plan.currentApp, expectedVersion: nil)
        try launchRecoveredCurrentApp()
        writeJournalBestEffort(state: "rolled-back", message: reason)
        logger.write("Rollback completed and the previous app was relaunched.")
        cleanupTransientArtifacts(removeCandidate: true)
    }

    private func launchRecoveredCurrentApp() throws {
        try runCommand(
            executable: "/usr/bin/open",
            arguments: [
                "-n",
                plan.currentApp,
                "--args",
                "--luma-update-recovery-token",
                plan.token,
            ]
        )
    }

    private func writeJournalBestEffort(state: String, message: String?) {
        do {
            try writeJournal(state: state, message: message)
        } catch {
            logger.write("Could not record \(state) update state: \(error.localizedDescription)")
        }
    }

    private func cleanupTransientArtifacts(removeCandidate: Bool) {
        let paths = (removeCandidate ? [plan.candidateApp] : []) + [plan.healthMarker, planPath]
        for path in paths where FileManager.default.fileExists(atPath: path) {
            do {
                try FileManager.default.removeItem(atPath: path)
                logger.write("Removed transient update artifact: \(path)")
            } catch {
                logger.write("Could not remove transient update artifact \(path): \(error.localizedDescription)")
            }
        }
    }

    private func terminateCandidateProcesses() {
        let processes = processIdsContainingToken(plan.token)
        for processId in processes where processId != getpid() {
            _ = Darwin.kill(processId, SIGTERM)
        }

        let gracefulDeadline = Date().addingTimeInterval(3)
        while Date() < gracefulDeadline {
            if processes.allSatisfy({ !processExists($0) }) { return }
            usleep(100_000)
        }

        for processId in processes where processExists(processId) {
            _ = Darwin.kill(processId, SIGKILL)
        }
    }

    private func writeJournal(state: String, message: String?) throws {
        let parent = URL(fileURLWithPath: plan.journalFile).deletingLastPathComponent().path
        try requireSecureWritableDirectory(parent, label: "journal parent")
        let record = JournalRecord(
            state: state,
            updatedAt: ISO8601DateFormatter().string(from: Date()),
            token: plan.token,
            currentApp: plan.currentApp,
            candidateApp: plan.candidateApp,
            expectedVersion: plan.expectedVersion,
            message: message
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(record)
        try data.write(to: URL(fileURLWithPath: plan.journalFile), options: .atomic)
        guard Darwin.chmod(plan.journalFile, S_IRUSR | S_IWUSR) == 0 else {
            throw HelperError.fileSystem("Unable to secure update journal: \(lastPOSIXError())")
        }
    }
}

private func validatePlan(_ plan: UpdatePlan) throws {
    guard plan.schemaVersion == supportedSchemaVersion else {
        throw HelperError.invalidPlan("Unsupported update plan schema version.")
    }
    guard plan.oldPid > 1, plan.oldPid != getpid() else {
        throw HelperError.invalidPlan("Invalid parent process identifier.")
    }
    guard plan.expectedBundleId == supportedBundleIdentifier else {
        throw HelperError.invalidPlan("Unexpected application bundle identifier.")
    }
    guard (5 ... 300).contains(plan.timeoutSeconds) else {
        throw HelperError.invalidPlan("Health timeout must be between 5 and 300 seconds.")
    }
    guard let parsedToken = UUID(uuidString: plan.token),
          parsedToken.uuidString.caseInsensitiveCompare(plan.token) == .orderedSame
    else {
        throw HelperError.invalidPlan("Update token must be a canonical UUID.")
    }
    guard plan.expectedVersion.range(of: #"^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$"#, options: .regularExpression) != nil else {
        throw HelperError.invalidPlan("Expected version has an invalid format.")
    }

    let absolutePaths = [
        plan.currentApp,
        plan.candidateApp,
        plan.healthMarker,
        plan.journalFile,
        plan.logFile,
    ]
    guard absolutePaths.allSatisfy({ $0.hasPrefix("/") && URL(fileURLWithPath: $0).standardized.path == $0 }) else {
        throw HelperError.invalidPlan("Every update path must be absolute and normalized.")
    }
    guard Set(absolutePaths).count == absolutePaths.count else {
        throw HelperError.invalidPlan("Update paths must be distinct.")
    }
    guard plan.currentApp.hasSuffix(".app"), plan.candidateApp.hasSuffix(".app") else {
        throw HelperError.invalidPlan("Current and candidate paths must be app bundles.")
    }

    let currentParent = URL(fileURLWithPath: plan.currentApp).deletingLastPathComponent().path
    let candidateParent = URL(fileURLWithPath: plan.candidateApp).deletingLastPathComponent().path
    guard currentParent == candidateParent else {
        throw HelperError.invalidPlan("Current and candidate app bundles must be siblings on the same volume.")
    }
    try requireSecureWritableDirectory(currentParent, label: "application parent")
    try requireSecureWritableDirectory(
        URL(fileURLWithPath: plan.healthMarker).deletingLastPathComponent().path,
        label: "health marker parent"
    )

    let currentStatus = try statusForPath(plan.currentApp, followSymlinks: false)
    let candidateStatus = try statusForPath(plan.candidateApp, followSymlinks: false)
    guard isDirectory(currentStatus), isDirectory(candidateStatus) else {
        throw HelperError.invalidPlan("Current and candidate app paths must be real directories, not symbolic links.")
    }
    guard currentStatus.st_dev == candidateStatus.st_dev else {
        throw HelperError.invalidPlan("Current and candidate app bundles are not on the same volume.")
    }
    guard currentStatus.st_ino != candidateStatus.st_ino else {
        throw HelperError.invalidPlan("Current and candidate app bundles refer to the same directory.")
    }

    try validateAppBundle(path: plan.currentApp, expectedVersion: nil)
    try validateAppBundle(path: plan.candidateApp, expectedVersion: plan.expectedVersion)
    try runCommand(executable: "/usr/bin/codesign", arguments: ["--verify", "--deep", "--strict", plan.candidateApp])
}

private func validateAppBundle(path: String, expectedVersion: String?) throws {
    guard let bundle = Bundle(path: path),
          bundle.bundleIdentifier == supportedBundleIdentifier,
          let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
          let executablePath = bundle.executablePath
    else {
        throw HelperError.invalidPlan("App bundle metadata is incomplete or unexpected: \(path)")
    }
    if let expectedVersion, version != expectedVersion {
        throw HelperError.invalidPlan("Candidate version \(version) does not match \(expectedVersion).")
    }
    let executableStatus = try statusForPath(executablePath, followSymlinks: false)
    guard isRegularFile(executableStatus), executableStatus.st_mode & S_IXUSR != 0 else {
        throw HelperError.invalidPlan("App bundle executable is missing, linked, or not executable.")
    }
}

private func requireSecureWritableDirectory(_ path: String, label: String) throws {
    let directoryStatus = try statusForPath(path, followSymlinks: false)
    guard isDirectory(directoryStatus) else {
        throw HelperError.fileSystem("The \(label) is not a real directory.")
    }
    guard access(path, W_OK) == 0 else {
        throw HelperError.fileSystem("The \(label) is not writable without elevation.")
    }
}

private func atomicSwap(_ first: String, _ second: String) throws {
    let result = first.withCString { firstPath in
        second.withCString { secondPath in
            renameatx_np(AT_FDCWD, firstPath, AT_FDCWD, secondPath, UInt32(RENAME_SWAP))
        }
    }
    guard result == 0 else {
        throw HelperError.fileSystem("Atomic app swap failed: \(lastPOSIXError())")
    }
}

private func waitForProcessExit(pid: pid_t, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if !processExists(pid) { return true }
        usleep(100_000)
    }
    return !processExists(pid)
}

private func processExists(_ pid: pid_t) -> Bool {
    if Darwin.kill(pid, 0) == 0 { return true }
    return errno == EPERM
}

private func processIdsContainingToken(_ token: String) -> [pid_t] {
    guard let output = try? commandOutput(
        executable: "/bin/ps",
        arguments: ["-ww", "-axo", "pid=,uid=,command="]
    ) else { return [] }

    let requiredArgument = "--luma-update-token \(token)"
    return output.split(separator: "\n").compactMap { line in
        let fields = line.split(maxSplits: 2, whereSeparator: { $0 == " " || $0 == "\t" })
        guard fields.count == 3,
              let processId = pid_t(fields[0]),
              let userId = uid_t(fields[1]),
              userId == geteuid(),
              fields[2].contains(requiredArgument)
        else { return nil }
        return processId
    }
}

private func runCommand(executable: String, arguments: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        throw HelperError.command("Could not run \(executable): \(error.localizedDescription)")
    }
    guard process.terminationReason == .exit, process.terminationStatus == 0 else {
        throw HelperError.command("\(executable) exited with status \(process.terminationStatus).")
    }
}

private func commandOutput(executable: String, arguments: [String]) throws -> String {
    let process = Process()
    let output = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    try process.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        throw HelperError.command("\(executable) exited with status \(process.terminationStatus).")
    }
    return String(decoding: data, as: UTF8.self)
}

private func statusForPath(_ path: String, followSymlinks: Bool) throws -> stat {
    var value = stat()
    let result = path.withCString { pointer in
        Darwin.fstatat(AT_FDCWD, pointer, &value, followSymlinks ? 0 : AT_SYMLINK_NOFOLLOW)
    }
    guard result == 0 else {
        throw HelperError.fileSystem("Unable to inspect \(path): \(lastPOSIXError())")
    }
    return value
}

private func isDirectory(_ value: stat) -> Bool {
    value.st_mode & S_IFMT == S_IFDIR
}

private func isRegularFile(_ value: stat) -> Bool {
    value.st_mode & S_IFMT == S_IFREG
}

private func lastPOSIXError() -> String {
    String(cString: strerror(errno))
}

private func readAndValidatePlan(at path: String) throws -> UpdatePlan {
    guard path.hasPrefix("/"), URL(fileURLWithPath: path).standardized.path == path else {
        throw HelperError.invalidPlan("Plan path must be absolute and normalized.")
    }
    let planStatus = try statusForPath(path, followSymlinks: false)
    guard isRegularFile(planStatus), planStatus.st_uid == geteuid(), planStatus.st_mode & 0o077 == 0 else {
        throw HelperError.invalidPlan("Plan must be a private regular file owned by the current user.")
    }
    let data = try Data(contentsOf: URL(fileURLWithPath: path), options: .mappedIfSafe)
    guard data.count <= 64 * 1024 else {
        throw HelperError.invalidPlan("Plan file is unexpectedly large.")
    }
    do {
        return try JSONDecoder().decode(UpdatePlan.self, from: data)
    } catch {
        throw HelperError.invalidPlan("Plan JSON is invalid: \(error.localizedDescription)")
    }
}

private func main() -> Int32 {
    let arguments = CommandLine.arguments
    guard arguments.count == 3, arguments[1] == "--plan" else {
        fputs("usage: luma-mac-update-helper --plan /absolute/path/to/plan.json\n", stderr)
        return 64
    }

    do {
        let plan = try readAndValidatePlan(at: arguments[2])
        try UpdateHelper(plan: plan, planPath: arguments[2]).run()
        return 0
    } catch {
        fputs("luma-mac-update-helper: \(error.localizedDescription)\n", stderr)
        return 1
    }
}

exit(main())
