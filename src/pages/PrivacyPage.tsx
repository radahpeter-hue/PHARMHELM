import React from 'react';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="bg-[#05192d] text-white selection:bg-[#b0f0d6] selection:text-[#003527] overflow-x-hidden min-h-screen relative font-sans">
      <header className="w-full top-0 bg-black/10 backdrop-blur-xl border-b border-white/10 z-50 sticky">
        <div className="flex justify-between items-center px-6 md:px-16 py-5 max-w-7xl mx-auto">
          <span className="text-xl md:text-2xl font-extrabold text-[#95d3ba] tracking-tighter">PharmHelm Pro</span>
          <div className="flex items-center gap-6">
            <a className="text-white text-sm hover:text-[#95d3ba] transition-colors duration-300" href="https://about.pharmhelm.com">About Us</a>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16 relative z-10 space-y-10">
        <div className="space-y-4">
          <span className="text-xs font-bold text-[#95d3ba] uppercase tracking-widest px-4 py-1.5 bg-white/10 rounded-full inline-block border border-white/5">Compliance & Policy</span>
          <h1 className="text-4xl md:text-5xl font-black text-white leading-tight">Privacy Policy</h1>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 text-xs font-bold text-white/60">
            <div>
              <p className="uppercase text-[#95d3ba]">Effective Date</p>
              <p className="text-white">16 June 2026</p>
            </div>
            <div>
              <p className="uppercase text-[#95d3ba]">Last Updated</p>
              <p className="text-white">16 June 2026</p>
            </div>
            <div>
              <p className="uppercase text-[#95d3ba]">Data Controller</p>
              <p className="text-white">Peter Sentongo</p>
            </div>
            <div>
              <p className="uppercase text-[#95d3ba]">Applies To</p>
              <p className="text-white">All Subscribed Users</p>
            </div>
          </div>
          <div className="h-[1px] bg-gradient-to-r from-transparent via-[#95d3ba]/40 to-transparent w-full pt-4"></div>
        </div>

        <div className="prose prose-invert max-w-none text-sm md:text-base text-white/80 leading-relaxed space-y-6 font-medium">
          <p>
            Peter Sentongo operates PharmHelm Pro as an individual sole proprietor. This policy will be updated to reflect a registered company name once incorporation is complete.
          </p>

          <h3 className="text-xl font-bold text-white uppercase tracking-wider text-base pt-4 border-b border-white/10 pb-2">1. Introduction</h3>
          <p>
            PharmHelm Pro (“the System,” “we,” “us,” or “our”) is a multi-tenant pharmacy management system designed for retail and wholesale pharmacies operating in Uganda. This Privacy Policy explains how we collect, use, store, share, and protect personal data and other information processed through the System.
          </p>
          <p>
            This policy is written to comply with the Uganda Data Protection and Privacy Act, 2019 (“DPPA”) and is intended to be read by two audiences: the pharmacy businesses (“Tenants”) that subscribe to PharmHelm Pro, and the individual staff, clients, and other persons whose data Tenants process using the System.
          </p>
          <p>
            This document explains our practices in plain language. It is not a substitute for independent legal advice. Tenants remain separately responsible for their own compliance obligations as data controllers of their own clients' and patients' data, as explained in Section 4.
          </p>

          <h3 className="text-xl font-bold text-white uppercase tracking-wider text-base pt-4 border-b border-white/10 pb-2">2. Who We Are and How the System Works</h3>
          <p>
            PharmHelm Pro is a multi-tenant Software-as-a-Service (SaaS) platform. Each subscribing pharmacy (“Tenant”) operates within its own isolated data space inside the System. We provide the infrastructure, software, and hosting; the Tenant determines what data is entered, retained, and how it is used in the course of running their pharmacy business.
          </p>
          <p>
            We act in two distinct roles depending on the data involved:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>As a Data Processor:</strong> for client, patient, prescriber, and institutional data that a Tenant enters into the System in the course of running their pharmacy. The Tenant is the Data Controller for this category of data.</li>
            <li><strong>As a Data Controller:</strong> for account, billing, and platform-usage data relating to the Tenant itself and its staff users, which we collect to operate, secure, and improve the System.</li>
          </ul>

          <h3 className="text-xl font-bold text-white uppercase tracking-wider text-base pt-4 border-b border-white/10 pb-2">3. Information We Collect</h3>
          <h4 className="text-base font-bold text-white">3.1 Tenant and Staff Account Information</h4>
          <p>We collect credentials, pharmacy names, registration tags, user names, roles, contact numbers, and logins via Firebase Authentication (e.g. secure hashed passwords) for dashboard setup and billing management.</p>
          
          <h4 className="text-base font-bold text-white">3.2 Operational Pharmacy Data (Entered by Tenants)</h4>
          <p>This includes all operational records entered into the Point of Sale transactions, stock movement files, controlled drug registers, finance ledgers, procurement requisitions, payroll databases, and quality logs. We do not access this data except to provide technical support, resolve issues, or fulfill legal duties.</p>

          <h4 className="text-base font-bold text-white">3.3 Technical and Usage Data</h4>
          <p>Device data, browser headers, page visit metrics, performance logs, and error telemetry are processed to secure, support, and continuously optimize platform services.</p>

          <h3 className="text-xl font-bold text-white uppercase tracking-wider text-base pt-4 border-b border-white/10 pb-2">4. Your Role and Ours — Controller and Processor Relationship</h3>
          <p>
            Tenants act as the Data Controllers for all client, patient, and drug registry records. Tenants must ensure they possess the necessary lawful basis (such as explicit consent) under the DPPA, NDA, and other Ugandan regulatory agencies. We act strictly as a Processor enforcing tenant isolation via database rules.
          </p>

          <h3 className="text-xl font-bold text-white uppercase tracking-wider text-base pt-4 border-b border-white/10 pb-2">5. Data Retention and Deletion</h3>
          <p>
            We retain active tenant database records during your subscription. Upon cancellation or termination, files are stored for a 180-day grace period. After 180 days, records are permanently deleted, save for regulatory controlled drug registers and ADR records, which NDA mandates we retain.
          </p>

          <h3 className="text-xl font-bold text-white uppercase tracking-wider text-base pt-4 border-b border-white/10 pb-2">6. Security &amp; Encryption</h3>
          <p>
            We employ bank-grade transport layer encryption, secure Firebase session tokens, role-based modules, and tenant security rules to block unauthorized connections.
          </p>
        </div>
      </main>

      <footer className="w-full bg-black/30 backdrop-blur-3xl border-t border-white/20 mt-20">
        <div className="flex flex-col md:flex-row justify-between items-center px-6 md:px-16 py-10 max-w-7xl mx-auto gap-6 text-xs text-white/70 font-bold">
          <p>© 2026 PharmHelm Pro. All rights reserved.</p>
          <div className="flex gap-4">
            <a className="hover:text-white transition-colors" href="https://about.pharmhelm.com">About Us</a>
            <span>|</span>
            <span className="text-white/50 cursor-default">Terms of Service</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
