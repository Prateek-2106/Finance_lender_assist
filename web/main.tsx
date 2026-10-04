import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Site } from "./site/Site";
import { Dashboard } from "./app/Dashboard";
import { Console } from "./uw/Console";

const at = (p: string) => location.pathname === p || location.pathname.startsWith(`${p}/`);
const page = at("/underwriting") ? <Console /> : at("/app") ? <Dashboard /> : <Site />;
createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
