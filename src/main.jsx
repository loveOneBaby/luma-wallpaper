import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ProductPage } from "./ProductPage.jsx";
import "./styles.css";

const showApp = window.location.hash === "#app" || new URLSearchParams(window.location.search).has("app");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {showApp ? <App /> : <ProductPage />}
  </React.StrictMode>,
);
