import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Site } from "./site/Site";
import { Dashboard } from "./app/Dashboard";

const isDashboard = location.pathname === "/app" || location.pathname.startsWith("/app/");
createRoot(document.getElementById("root")!).render(<StrictMode>{isDashboard ? <Dashboard /> : <Site />}</StrictMode>);
