import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { api, session, takeKeyFromHash, uwSession } from "./api";
import { Site } from "./site/Site";
import { Dashboard } from "./app/Dashboard";
import { Console } from "./uw/Console";
import { Home, type Platform } from "./home/Home";
import { Scoring } from "./scoring/Scoring";
import { AccountPage, ForgotPage, SignInPage, SignUpPage, VerifyPage } from "./account/Account";
import { AdminPage } from "./admin/Admin";

/** "/" is the platform's homepage on the main domain, and a business's own website on its address. */
function Root() {
  const [platform, setPlatform] = useState<Platform | null | undefined>(undefined);
  useEffect(() => {
    api<{ platform: Platform }>("/platform").then((r) => setPlatform(r.platform), () => setPlatform(null));
  }, []);
  if (platform === undefined) return null;
  const host = location.hostname.toLowerCase();
  const apex = platform && (host === platform.baseDomain || host === `www.${platform.baseDomain}` || host === "localhost" || host === "127.0.0.1");
  return apex ? <Home platform={platform} /> : <Site />;
}

const at = (p: string) => location.pathname === p || location.pathname.startsWith(`${p}/`);
if (at("/app")) takeKeyFromHash(session, "#/requests"); // a demo opens where the work starts
if (at("/underwriting")) takeKeyFromHash(uwSession, "#/");
const page = at("/signin") ? <SignInPage /> : at("/signup") ? <SignUpPage /> : at("/verify") ? <VerifyPage /> : at("/forgot") ? <ForgotPage /> : at("/account") ? <AccountPage /> : at("/admin") ? <AdminPage /> : at("/scoring") ? <Scoring /> : at("/underwriting") ? <Console /> : at("/app") ? <Dashboard /> : <Root />;
createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
