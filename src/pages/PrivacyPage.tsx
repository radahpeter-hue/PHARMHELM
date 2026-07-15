import React from 'react';
import { Printer, Mail } from 'lucide-react';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="bg-[#fcf9f8] text-[#1c1b1b] font-sans selection:bg-[#b0f0d6] selection:text-[#003527] min-h-screen flex flex-col">
      {/* Top Navigation */}
      <header className="bg-[#fcf9f8] sticky top-0 z-50 border-b border-[#bfc9c3] h-20 flex justify-between items-center w-full px-6 md:px-16 max-w-7xl mx-auto no-print">
        <div className="flex items-center gap-8">
          <span className="text-xl md:text-2xl font-extrabold text-[#003527] uppercase tracking-tight">PharmHelm Pro</span>
          <div className="hidden md:flex gap-6 items-center">
            <span className="text-[#5e5f5b] text-[10px] font-bold uppercase tracking-widest">Security Protocol: P-442</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => window.print()} 
            className="flex items-center gap-2 px-4 py-2 text-[#003527] border border-[#003527] rounded-sm font-bold text-xs uppercase hover:bg-[#f6f3f2] transition-all"
          >
            <Printer size={18} />
            PRINT ARCHIVE
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 md:px-16 grid grid-cols-1 md:grid-cols-12 gap-8 py-12 relative flex-1">
        
        {/* Side Navigation (Index) */}
        <aside className="hidden md:block md:col-span-3 sticky top-32 h-fit no-print">
          <div className="p-6 border border-[#bfc9c3] border-l-4 border-l-[#003527] rounded-sm bg-white/50 backdrop-blur-md">
            <h3 className="text-lg font-bold text-[#003527] mb-6 uppercase tracking-tight">Archive Index</h3>
            <nav className="flex flex-col gap-4 text-xs font-bold text-[#5e5f5b]">
              <a href="#section-1" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">01</span> Introduction
              </a>
              <a href="#section-2" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">02</span> Who We Are
              </a>
              <a href="#section-3" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">03</span> Information Collection
              </a>
              <a href="#section-4" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">04</span> Controller Relationship
              </a>
              <a href="#section-5" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">05</span> Usage Protocols
              </a>
              <a href="#section-6" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">06</span> Data Storage
              </a>
              <a href="#section-7" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">07</span> Third Parties
              </a>
              <a href="#section-8" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">08</span> Retention Policy
              </a>
              <a href="#section-9" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">09</span> Data Security
              </a>
              <a href="#section-10" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">10</span> Your Rights
              </a>
              <a href="#section-11" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">11</span> Children's Data
              </a>
              <a href="#section-12" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">12</span> Revisions
              </a>
              <a href="#section-13" className="hover:text-[#003527] transition-all flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#bfc9c3]">13</span> Contact
              </a>
            </nav>
          </div>
        </aside>

        {/* Document Content */}
        <article className="md:col-span-9 max-w-3xl">
          {/* Header Meta */}
          <div className="mb-12 border-b border-[#bfc9c3] pb-8">
            <h1 className="text-4xl md:text-5xl font-extrabold text-[#003527] mb-6 tracking-tight">Privacy Policy</h1>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-mono text-[12px] uppercase text-[#404944]">
              <div className="flex flex-col gap-1">
                <span className="opacity-50">Document Status</span>
                <span className="text-[#003527] font-bold">Active Protocol</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="opacity-50">Effective Date</span>
                <span className="text-[#003527] font-bold">16 June 2026</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="opacity-50">Data Controller</span>
                <span className="text-[#003527] font-bold">PharmHelm PRO</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="opacity-50">Reference ID</span>
                <span className="text-[#003527] font-bold">PH-PP-2026-06</span>
              </div>
            </div>
          </div>

          {/* Content Sections */}
          <div className="space-y-12">
              
            {/* 1. Introduction */}
            <section id="section-1" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">01</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Introduction</h2>
              </div>
              <div className="bg-white p-8 border border-[#bfc9c3] rounded-sm shadow-sm">
                <p className="text-sm md:text-base leading-relaxed">
                  Welcome to PharmHelm Pro. This Privacy Policy outlines our commitment to the clinical-grade security and ethical handling of your personal and professional data. We operate with a philosophy of radical transparency, ensuring that you understand exactly how your information is processed within our ecosystem.
                </p>
              </div>
            </section>

            {/* 2. Who We Are */}
            <section id="section-2" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">02</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Who We Are</h2>
              </div>
              <div className="bg-white p-8 border border-[#bfc9c3] rounded-sm shadow-sm">
                <p className="text-sm md:text-base leading-relaxed">
                  PharmHelm PRO is a precision pharmaceutical management platform designed for healthcare professionals. We provide the structural intelligence required to manage inventory, prescriptions, and complex medical analytics with unwavering reliability.
                </p>
              </div>
            </section>

            {/* 3. Information We Collect */}
            <section id="section-3" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">03</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Information We Collect</h2>
              </div>
              <div className="bg-white p-8 border border-[#bfc9c3] rounded-sm shadow-sm">
                <div className="space-y-6">
                  <div>
                    <h4 className="font-bold text-xs text-[#003527] uppercase tracking-wider mb-2">A. Personal Identifiers</h4>
                    <p className="text-sm">Name, professional licensure numbers, official email addresses, and clinic affiliations.</p>
                  </div>
                  <div className="border-t border-[#bfc9c3] pt-4">
                    <h4 className="font-bold text-xs text-[#003527] uppercase tracking-wider mb-2">B. Professional Data</h4>
                    <p className="text-sm">Prescription history, inventory movement logs, and clinical decision-making patterns within the application.</p>
                  </div>
                  <div className="border-t border-[#bfc9c3] pt-4">
                    <h4 className="font-bold text-xs text-[#003527] uppercase tracking-wider mb-2">C. Technical Telemetry</h4>
                    <p className="text-sm">IP addresses, device metadata, and cryptographically hashed session identifiers.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* 4. Controller/Processor Relationship */}
            <section id="section-4" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">04</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Controller/Processor Relationship</h2>
              </div>
              <div className="bg-white p-8 border border-[#bfc9c3] border-l-4 border-l-[#4f1f19] rounded-sm shadow-sm">
                <blockquote className="text-sm md:text-base italic text-[#1c1b1b]">
                  "PharmHelm PRO acts as the Data Controller for your account information and as a Data Processor for the patient-specific health information you input into our system."
                </blockquote>
                <p className="mt-4 text-xs md:text-sm text-[#404944]">
                  This dual-role ensures that we provide the maximum legal protection applicable to different classes of medical data under global regulatory standards.
                </p>
              </div>
            </section>

            {/* 5. How We Use Information */}
            <section id="section-5" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">05</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">How We Use Information</h2>
              </div>
              <div className="bg-white p-8 border border-[#bfc9c3] rounded-sm shadow-sm">
                <ul className="list-none space-y-4 text-xs md:text-sm">
                  <li className="flex gap-3">
                    <span className="text-[#003527] font-bold">—</span>
                    <span>Verification of clinical credentials to prevent unauthorized access.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-[#003527] font-bold">—</span>
                    <span>Optimization of automated inventory replenishment algorithms.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-[#003527] font-bold">—</span>
                    <span>Regulatory reporting as required by national health authorities.</span>
                  </li>
                </ul>
              </div>
            </section>

            {/* 6. Data Storage */}
            <section id="section-6" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">06</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Data Storage</h2>
              </div>
              <div className="bg-white p-8 border border-[#bfc9c3] rounded-sm shadow-sm">
                <p className="text-xs md:text-sm leading-relaxed">
                  All information is stored in high-security, medical-grade data centers located in the European Economic Area (EEA) and North America. All storage volumes are encrypted at rest using AES-256 standard protocols.
                </p>
              </div>
            </section>

            {/* 7. Third-Party Providers */}
            <section id="section-7" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">07</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Third-Party Providers</h2>
              </div>
              <div className="bg-white p-8 border border-[#bfc9c3] rounded-sm shadow-sm">
                <p className="text-xs md:text-sm mb-4">
                  We engage only with verified partners who maintain equivalent or superior security postures:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border border-[#bfc9c3] bg-[#f0eded]">
                    <span className="text-xs font-bold block mb-1">Infrastructure</span>
                    <span className="text-[11px] text-[#404944]">AWS Healthcare Cloud</span>
                  </div>
                  <div className="p-4 border border-[#bfc9c3] bg-[#f0eded]">
                    <span className="text-xs font-bold block mb-1">Analytics</span>
                    <span className="text-[11px] text-[#404944]">Internal Proprietary Engine</span>
                  </div>
                </div>
              </div>
            </section>

            {/* 8. Retention and Deletion */}
            <section id="section-8" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">08</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Retention and Deletion</h2>
              </div>
              <div className="bg-white p-8 border border-[#bfc9c3] rounded-sm shadow-sm">
                <p className="text-xs md:text-sm leading-relaxed">
                  Data is retained for the duration of your professional subscription plus a statutory period of 7 years to comply with pharmaceutical record-keeping laws. Upon formal request, non-statutory data is purged within 30 days.
                </p>
              </div>
            </section>

            {/* 9. Data Security */}
            <section id="section-9" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">09</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Data Security</h2>
              </div>
              <div className="relative overflow-hidden rounded-sm">
                <div className="bg-[#003527] text-white p-8 border border-[#003527] relative z-10 space-y-4">
                  <h4 className="text-lg md:text-xl font-bold">SOC2 Type II Certified</h4>
                  <p className="text-xs md:text-sm opacity-90 leading-relaxed">
                    We employ multi-factor authentication (MFA), end-to-end encryption for all data in transit, and continuous biometric monitoring for our data facilities.
                  </p>
                  <div className="flex gap-4 pt-2">
                    <div className="px-3 py-1 border border-white/30 font-mono text-[9px] uppercase">Firewall Active</div>
                    <div className="px-3 py-1 border border-white/30 font-mono text-[9px] uppercase">Encryption: TLS 1.3</div>
                  </div>
                </div>
              </div>
            </section>

            {/* 10. Your Rights */}
            <section id="section-10" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">10</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Your Rights</h2>
              </div>
              <div className="bg-white p-8 border border-[#bfc9c3] rounded-sm shadow-sm">
                <p className="text-xs md:text-sm mb-6 font-bold">Under GDPR and HIPAA, you possess the following inalienable rights regarding your data:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
                  <div>
                    <span className="text-xs font-bold text-[#003527] block border-b border-[#bfc9c3] mb-2 pb-1">Access</span>
                    <p className="text-[11px] text-[#404944]">Request a machine-readable archive of all data points held in your name.</p>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-[#003527] block border-b border-[#bfc9c3] mb-2 pb-1">Rectification</span>
                    <p className="text-[11px] text-[#404944]">The right to correct inaccurate clinical or personal records immediately.</p>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-[#003527] block border-b border-[#bfc9c3] mb-2 pb-1">Erasure</span>
                    <p className="text-[11px] text-[#404944]">The 'Right to be Forgotten' for all data not mandated by law.</p>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-[#003527] block border-b border-[#bfc9c3] mb-2 pb-1">Portability</span>
                    <p className="text-[11px] text-[#404944]">Securely transfer your inventory and prescription datasets to other providers.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* 11. Children's Data */}
            <section id="section-11" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">11</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Children's Data</h2>
              </div>
              <div className="bg-white p-8 border border-[#bfc9c3] rounded-sm shadow-sm">
                <p className="text-xs md:text-sm leading-relaxed">
                  PharmHelm Pro is not intended for use by individuals under 18 years of age. While we process patient data which may include minors (under professional care), we do not knowingly collect personal data directly from children.
                </p>
              </div>
            </section>

            {/* 12. Changes */}
            <section id="section-12" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">12</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Changes</h2>
              </div>
              <div className="bg-white p-8 border border-[#bfc9c3] rounded-sm shadow-sm">
                <p className="text-xs md:text-sm leading-relaxed">
                  We reserve the right to amend this policy as regulatory frameworks evolve. Significant changes will be communicated via clinical bulletin 30 days prior to implementation.
                </p>
              </div>
            </section>

            {/* 13. Contact Us */}
            <section id="section-13" className="scroll-mt-32">
              <div className="flex gap-4 items-baseline mb-4">
                <span className="text-xl font-mono text-[#bfc9c3]">13</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-[#003527] tracking-tight">Contact Us</h2>
              </div>
              <div className="bg-[#064e3b] p-8 border border-[#064e3b] text-white rounded-sm">
                <p className="text-xs md:text-sm mb-4">For data access requests or security inquiries, please contact our Data Protection Officer:</p>
                <div className="flex items-center gap-3 font-mono text-xs md:text-sm">
                  <Mail size={16} />
                  <span>pharmhelmpro@gmail.com</span>
                </div>
              </div>
            </section>
          </div>
          
          {/* Footer Meta for Archive */}
          <div className="mt-16 pt-6 border-t border-[#bfc9c3] font-mono text-[9px] text-[#404944] flex flex-col md:flex-row justify-between uppercase opacity-50">
            <span>End of Document: PH-PP-2026-06</span>
            <span>Verified by PharmHelm Compliance Dept.</span>
          </div>
        </article>
      </main>

      {/* Footer */}
      <footer className="bg-[#e3e3de] mt-16 border-t border-[#bfc9c3] no-print">
        <div className="w-full py-8 px-6 md:px-16 max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center text-xs">
          <div className="flex flex-col items-center md:items-start mb-6 md:mb-0">
            <span className="font-bold text-base text-[#003527]">PharmHelm Pro</span>
            <span className="text-[#646561] mt-1">© 2026 PharmHelm Pro. All Rights Reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
