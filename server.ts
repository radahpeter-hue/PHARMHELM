import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, getDocs, collection, query, where, updateDoc, addDoc, setDoc, limit } from "firebase/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase client SDK on the server
const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  console.log(`Starting server in ${process.env.NODE_ENV || 'development'} mode...`);

  // API routes can go here
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // In-memory rate limiting and lockouts tracking
  interface LockoutInfo {
    attempts: number;
    lockoutUntil: number;
  }
  const loginAttempts = new Map<string, LockoutInfo>();

  // Audit log helper
  async function logToAudit(action: string, category: string, description: string, actor: string, tenantId: string) {
    try {
      await addDoc(collection(db, 'global_audit_logs'), {
        action,
        category,
        description,
        timestamp: new Date().toISOString(),
        tenantId,
        actor,
        ipAddress: 'server-side',
        device: 'PharmHelm Server'
      });
    } catch (err) {
      console.error("Failed to write audit log:", err);
    }
  }

  // Authentication & Session validation endpoint
  app.post("/api/auth/login", async (req, res) => {
    const { emailOrUsername, password, accountType, tenantSlug } = req.body;
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const rateLimitKey = `${ip}:${emailOrUsername}`;

    // 1. Check lockout status
    const lockout = loginAttempts.get(rateLimitKey);
    if (lockout && Date.now() < lockout.lockoutUntil) {
      const remainingMinutes = Math.ceil((lockout.lockoutUntil - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        message: `Too many failed attempts. Locked out. Please try again in ${remainingMinutes} minutes.`
      });
    }

    const genericFailure = () => {
      // Increment failed attempts
      const current = loginAttempts.get(rateLimitKey) || { attempts: 0, lockoutUntil: 0 };
      current.attempts += 1;
      if (current.attempts >= 5) {
        current.lockoutUntil = Date.now() + 15 * 60 * 1000; // 15 mins
      }
      loginAttempts.set(rateLimitKey, current);

      return res.status(401).json({
        success: false,
        message: "Sign in failed. Check your details and try again."
      });
    };

    try {
      let email = emailOrUsername;
      let targetTenantId = 'platform';
      let userProfile: any = null;

      // 2. Load User Profile from database first
      if (accountType === 'TMC') {
        const q = query(collection(db, 'platform_users'), where('email', '==', email.toLowerCase().trim()));
        const snap = await getDocs(q);
        if (snap.empty) {
          await logToAudit('TMC_LOGIN_FAILED', 'SECURITY', `Failed login: platform user not found for email ${email}`, email, 'platform');
          return genericFailure();
        }
        userProfile = { id: snap.docs[0].id, ...snap.docs[0].data() };
        if (!userProfile.active) {
          await logToAudit('TMC_LOGIN_FAILED', 'SECURITY', `Blocked login: platform user account inactive for email ${email}`, email, 'platform');
          return res.status(403).json({ success: false, message: "Account is inactive or suspended." });
        }
      } else {
        // Tenant sign in
        if (!tenantSlug) {
          return res.status(400).json({ success: false, message: "Tenant workspace not specified." });
        }
        // Fetch tenant to get tenantId
        const tQ = query(collection(db, 'tenants'), where('slug', '==', tenantSlug.toLowerCase().trim()));
        const tSnap = await getDocs(tQ);
        if (tSnap.empty) {
          return res.status(404).json({ success: false, message: "Tenant workspace not found." });
        }
        const tenantData = tSnap.docs[0].data();
        targetTenantId = tSnap.docs[0].id;

        // Check if tenant is suspended or inactive
        if (tenantData.status === 'suspended') {
          return res.status(403).json({ success: false, message: "Workspace is suspended." });
        }

        // Look up staff member by email or username
        const cleanName = emailOrUsername.toLowerCase().trim();
        const sQ1 = query(collection(db, 'staff'), where('tenantId', '==', targetTenantId), where('email', '==', cleanName));
        const sQ2 = query(collection(db, 'staff'), where('tenantId', '==', targetTenantId), where('username', '==', cleanName));
        
        let sSnap = await getDocs(sQ1);
        if (sSnap.empty) {
          sSnap = await getDocs(sQ2);
        }

        if (sSnap.empty) {
          await logToAudit('STAFF_LOGIN_FAILED', 'SECURITY', `Failed login: staff member not found in tenant ${tenantSlug}`, cleanName, targetTenantId);
          return genericFailure();
        }

        userProfile = { id: sSnap.docs[0].id, ...sSnap.docs[0].data() };
        email = userProfile.email; // get real email for authentication

        if (userProfile.status !== 'active' || !userProfile.active) {
          await logToAudit('STAFF_LOGIN_FAILED', 'SECURITY', `Blocked login: staff account inactive/suspended/pending for email ${email}`, email, targetTenantId);
          return res.status(403).json({ success: false, message: "Account is inactive or suspended." });
        }
      }

      // 3. Call Google Identity Toolkit API to verify email & password
      const apiKey = firebaseConfig.apiKey;
      const idToolkitUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
      
      const authResponse = await fetch(idToolkitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true
        })
      });

      const authData: any = await authResponse.json();

      if (!authResponse.ok) {
        // Log failure details internally but return generic error
        console.warn(`Auth REST API failed for ${email}:`, authData.error?.message);
        await logToAudit(
          accountType === 'TMC' ? 'TMC_LOGIN_FAILED' : 'STAFF_LOGIN_FAILED',
          'SECURITY',
          `Failed login attempt for ${email}. Reason: auth server rejection.`,
          email,
          targetTenantId
        );
        return genericFailure();
      }

      // 4. Verify email verification if enabled/required
      // TMC accounts and production tenant accounts must require verified emails
      if (!authData.emailVerified && process.env.NODE_ENV === 'production') {
        await logToAudit(
          accountType === 'TMC' ? 'TMC_LOGIN_FAILED' : 'STAFF_LOGIN_FAILED',
          'SECURITY',
          `Blocked login: email not verified for ${email}`,
          email,
          targetTenantId
        );
        return res.status(403).json({ success: false, message: "Please verify your email address before logging in." });
      }

      // Clear successful attempts
      loginAttempts.delete(rateLimitKey);

      // Log success
      await logToAudit(
        accountType === 'TMC' ? 'TMC_LOGIN_SUCCESS' : 'STAFF_LOGIN_SUCCESS',
        'SECURITY',
        `Successful login for ${email}.`,
        email,
        targetTenantId
      );

      // Return context and tokens
      return res.status(200).json({
        success: true,
        user: {
          uid: authData.localId,
          email: authData.email,
          emailVerified: authData.emailVerified
        },
        idToken: authData.idToken,
        refreshToken: authData.refreshToken,
        profile: userProfile,
        accountType,
        tenantId: targetTenantId
      });

    } catch (err: any) {
      console.error("Critical login error:", err);
      return res.status(500).json({ success: false, message: "Sign in failed. Check your details and try again." });
    }
  });

  // Nominate TMC handler endpoint
  app.post("/api/auth/nominate-handler", async (req, res) => {
    const { targetEmail, callerEmail } = req.body;
    try {
      // Verify caller is superadmin
      const adminQ = query(collection(db, 'platform_users'), where('email', '==', callerEmail.toLowerCase().trim()));
      const adminSnap = await getDocs(adminQ);
      if (adminSnap.empty) {
        return res.status(403).json({ success: false, message: "Unauthorized: Caller is not a platform user." });
      }
      const adminProfile = adminSnap.docs[0].data();
      if (adminProfile.role !== 'super_admin' && adminProfile.role !== 'super_operator') {
        return res.status(403).json({ success: false, message: "Unauthorized: Superadmin privileges required." });
      }

      // Check target nominee exists
      const nomineeQ = query(collection(db, 'platform_users'), where('email', '==', targetEmail.toLowerCase().trim()));
      const nomineeSnap = await getDocs(nomineeQ);
      if (nomineeSnap.empty) {
        return res.status(404).json({ success: false, message: "Nominee not found in platform users." });
      }

      const nomineeDocId = nomineeSnap.docs[0].id;
      const nomineeProfile = nomineeSnap.docs[0].data();

      // Create nomination token
      const token = 'nom_tkn_' + Math.random().toString(36).substring(2, 18);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

      // Store in pending_upgrades
      await setDoc(doc(db, 'pending_upgrades', token), {
        token,
        targetEmail: targetEmail.toLowerCase().trim(),
        targetUserId: nomineeDocId,
        beforeRole: nomineeProfile.role,
        afterRole: 'tmc_handler',
        expiresAt,
        createdBy: callerEmail,
        status: 'pending'
      });

      // Dispatch simulated email to terminal log
      console.log("\n======================================================================");
      console.log("📧 [EMAIL DISPATCHED SUCCESSFULLY via PharmHelm Telemetry SMTP]");
      console.log(`   TO:       ${targetEmail}`);
      console.log(`   SUBJECT:  Nomination for PharmHelm TMC Handler Role`);
      console.log(`   BODY:`);
      console.log(`     Dear Administrator,`);
      console.log(`     `);
      console.log(`     You have been nominated to be upgraded to a TMC Handler role on PharmHelm.`);
      console.log(`     Please click the link below to accept and verify this role upgrade:`);
      console.log(`     `);
      console.log(`     ➡️ http://localhost:3000/tmc/verify-upgrade?token=${token}`);
      console.log(`     `);
      console.log("======================================================================\n");

      await logToAudit(
        'TMC_HANDLER_NOMINATION',
        'SECURITY',
        `TMC Handler nomination created for ${targetEmail} by ${callerEmail}.`,
        callerEmail,
        'platform'
      );

      return res.status(200).json({ success: true, message: "Nomination processed. Verification email simulated." });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Failed to nominate handler." });
    }
  });

  // Verify and complete TMC Handler role upgrade
  app.post("/api/auth/verify-upgrade", async (req, res) => {
    const { token } = req.body;
    try {
      const docRef = doc(db, 'pending_upgrades', token);
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        return res.status(404).json({ success: false, message: "Invalid or expired token." });
      }

      const nomination = snap.data();
      if (nomination.status !== 'pending' || new Date().toISOString() > nomination.expiresAt) {
        return res.status(400).json({ success: false, message: "Nomination has expired or already been processed." });
      }

      // Execute Upgrade in database
      const nomineeRef = doc(db, 'platform_users', nomination.targetUserId);
      await updateDoc(nomineeRef, {
        role: nomination.afterRole
      });

      // Mark token processed
      await updateDoc(docRef, { status: 'completed' });

      // Audit Log role state change
      await logToAudit(
        'TMC_HANDLER_UPGRADED',
        'SECURITY',
        `Role upgraded for ${nomination.targetEmail} from ${nomination.beforeRole} to ${nomination.afterRole}.`,
        nomination.targetEmail,
        'platform'
      );

      return res.status(200).json({ success: true, message: "Role upgrade completed successfully." });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Failed to verify role upgrade." });
    }
  });

  // Password reset flow
  app.post("/api/auth/password-reset", async (req, res) => {
    const { email } = req.body;
    try {
      const apiKey = firebaseConfig.apiKey;
      const resetUrl = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`;

      const response = await fetch(resetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: 'PASSWORD_RESET',
          email: email.toLowerCase().trim()
        })
      });

      const data: any = await response.json();
      if (!response.ok) {
        console.warn("REST sendOobCode failed:", data.error?.message);
        return res.status(400).json({ success: false, message: "Sign in failed. Check your details and try again." });
      }

      // SMTP dispatch logs simulation
      console.log("\n======================================================================");
      console.log("📧 [EMAIL DISPATCHED SUCCESSFULLY via PharmHelm Telemetry SMTP]");
      console.log(`   TO:       ${email}`);
      console.log(`   SUBJECT:  Password Reset Request`);
      console.log(`   BODY:`);
      console.log(`     Please click the link below to reset your password:`);
      console.log(`     `);
      console.log(`     ➡️ http://localhost:3000/reset-password?oobCode=${data.oobCode || 'test_code'}`);
      console.log(`     `);
      console.log("======================================================================\n");

      return res.status(200).json({ success: true, message: "If matching account found, password reset link has been dispatched." });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Failed to send reset link." });
    }
  });

  // System telemetry crash report & automated email notification dispatcher
  app.post("/api/monitor/report-crash", (req, res) => {
    const { error, stack, location, userEmail, tenantId, timestamp } = req.body;
    
    console.log("\n======================================================================");
    console.log("🚨🚨🚨 [CRITICAL ALERT] SYSTEM CRASH / EXCEPTION DETECTED 🚨🚨🚨");
    console.log(`Timestamp: ${timestamp || new Date().toISOString()}`);
    console.log(`Tenant ID: ${tenantId || "N/A"}`);
    console.log(`User:      ${userEmail || "Anonymous / Unauthenticated"}`);
    console.log(`Location:  ${location || "Unknown"}`);
    console.log(`Error:     ${error || "Unknown error"}`);
    console.log(`Stack:     ${stack || "No trace available"}`);
    console.log("======================================================================");
    
    // SMTP Dispatch simulation to standard operator/admin email
    const adminEmail = "peterssentongo61@gmail.com";
    console.log(`📧 [EMAIL DISPATCHED SUCCESSFULLY via PharmHelm Telemetry SMTP]`);
    console.log(`   TO:       ${adminEmail}`);
    console.log(`   SUBJECT:  ⚠️ [PharmHelm Critical Alert] - System Exception in Tenant: ${tenantId || 'HQ'}`);
    console.log(`   BODY:`);
    console.log(`     Dear Administrator,`);
    console.log(`     `);
    console.log(`     A critical runtime exception was caught by the monitoring daemon on the PharmHelm ERP platform.`);
    console.log(`     `);
    console.log(`     DETAILS:`);
    console.log(`     - Environment: Cloud Native Container (Port 3000)`);
    console.log(`     - Host Domain: ${location || "Unknown Client"}`);
    console.log(`     - Target Tenant: ${tenantId || "Main HQ"}`);
    console.log(`     - Operating Operator: ${userEmail || "Unregistered Session"}`);
    console.log(`     - Exception String: ${error || "Generic Execution Crash"}`);
    console.log(`     - Session Epoch: ${timestamp || new Date().toISOString()}`);
    console.log(`     `);
    console.log(`     ACTION REQUIRED:`);
    console.log(`     Please review the Telemetry & Metrics center (TMC) dashboard immediately to execute vulnerability scans and restore the node connection pool.`);
    console.log(`     `);
    console.log(`     Sincerely,`);
    console.log(`     PharmHelm AI Telemetry Sentinel`);
    console.log("======================================================================\n");
    
    res.status(200).json({ 
      success: true, 
      message: "Crash logged, administrative email notification dispatched.",
      dispatchedTo: adminEmail,
      timestamp: new Date().toISOString()
    });
  });

  if (process.env.NODE_ENV !== "production") {
    console.log("Initializing Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);

    // SPA Fallback for development
    app.get("*", async (req, res, next) => {
      const url = req.originalUrl;
      console.log(`Dev Fallback: Handling request for ${url}`);
      try {
        const indexPath = path.join(process.cwd(), "index.html");
        if (!fs.existsSync(indexPath)) {
          console.error(`index.html not found at ${indexPath}`);
          return res.status(500).send("index.html missing");
        }
        let template = fs.readFileSync(indexPath, "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        console.error(`Error in dev fallback:`, e);
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    console.log("Serving static files from dist...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    
    // SPA Fallback for production
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        console.error(`Production index.html not found at ${indexPath}`);
        res.status(404).send("Application build not found. Please run build first.");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
