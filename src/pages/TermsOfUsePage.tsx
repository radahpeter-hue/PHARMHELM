import React, { useEffect } from 'react';
import { Download, Printer, X } from 'lucide-react';

const publicUrl = (subdomain: 'privacy' | 'www') => {
  const host = window.location.hostname.toLowerCase();
  if (host.includes('localhost') || host.includes('web.app') || host.includes('firebaseapp.com')) {
    return subdomain === 'privacy' ? '/privacy' : '/';
  }
  return subdomain === 'privacy' ? 'https://privacy.pharmhelm.com' : 'https://pharmhelm.com';
};

export const TermsOfUsePage: React.FC = () => {
  useEffect(() => {
    document.title = 'Terms of Service | PharmHelm Pro';
  }, []);

  return (
    <div className="min-h-screen bg-[#fcf9f8] text-[#1c1b1b] print:bg-white">
      <header className="sticky top-0 z-40 border-b border-[#bfc9c3] bg-[#fcf9f8]/95 backdrop-blur print:static">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 md:px-12">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="PharmHelm" className="h-10 w-10" />
            <div>
              <p className="text-lg font-extrabold tracking-tight text-[#003527]">PharmHelm Pro</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#5e5f5b]">Terms of Service</p>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#5e5f5b] hover:bg-[#f0eded]" type="button">
              <Printer size={17} /> <span className="hidden sm:inline">Print</span>
            </button>
            <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#5e5f5b] hover:bg-[#f0eded]" type="button" title="Use the print dialog to save as PDF">
              <Download size={17} /> <span className="hidden sm:inline">Save PDF</span>
            </button>
            <a href={publicUrl('www')} aria-label="Close terms and return to PharmHelm" className="rounded-xl p-2 text-[#5e5f5b] hover:bg-[#f0eded]">
              <X size={20} />
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        <aside className="sticky top-20 hidden h-[calc(100vh-5rem)] w-72 shrink-0 border-r border-[#bfc9c3] px-8 py-10 md:block print:hidden">
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.18em] text-[#5e5f5b]">Document index</p>
          <nav className="space-y-2 text-sm font-semibold">
            <a href="#metadata" className="block border-l-2 border-transparent px-4 py-2 text-[#5e5f5b] hover:border-[#003527] hover:bg-[#f0eded] hover:text-[#003527]">Document metadata</a>
            <a href="#section-1" className="block border-l-2 border-transparent px-4 py-2 text-[#5e5f5b] hover:border-[#003527] hover:bg-[#f0eded] hover:text-[#003527]">1. Introduction</a>
            <a href="#section-2" className="block border-l-2 border-transparent px-4 py-2 text-[#5e5f5b] hover:border-[#003527] hover:bg-[#f0eded] hover:text-[#003527]">2. Relationship</a>
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-5 py-12 sm:px-10 md:px-16 md:py-16 lg:px-24">
          <section id="metadata" className="scroll-mt-28 border-b border-[#bfc9c3] pb-10">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#2b6954]">Legal</p>
            <h1 className="mb-8 text-4xl font-extrabold tracking-tight text-[#003527] sm:text-5xl md:text-6xl">Website Terms of Service</h1>
            <div className="grid gap-5 rounded-2xl border border-[#bfc9c3] bg-white p-6 sm:grid-cols-2">
              <div><p className="text-xs font-bold uppercase tracking-widest text-[#5e5f5b]">Version</p><p className="mt-1 text-xl font-bold">1.0</p></div>
              <div><p className="text-xs font-bold uppercase tracking-widest text-[#5e5f5b]">Effective date</p><p className="mt-1 text-xl font-bold">18th August</p></div>
              <div className="sm:col-span-2"><p className="text-xs font-bold uppercase tracking-widest text-[#5e5f5b]">Provider</p><p className="mt-1 font-semibold">Radah Pharmaceutical Services Ltd.</p></div>
            </div>
          </section>

          <article className="space-y-14 py-12 font-serif text-lg leading-8 text-[#404944] md:text-xl">
            <section id="section-1" className="scroll-mt-28">
              <h2 className="mb-5 font-sans text-3xl font-bold tracking-tight text-[#003527]"><span className="mr-3 text-[#2b6954]/50">01</span>Introduction</h2>
              <p className="mb-5">These Website Terms of Service (these &quot;Terms&quot;) contained herein on this webpage govern your access to and use of this website, including any content, functionality, and services offered on or through this website (collectively, the &quot;Website&quot;).</p>
              <p>The Website is operated by Radah Pharmaceutical Services Ltd. (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).</p>
            </section>
            <section id="section-2" className="scroll-mt-28 border-t border-[#bfc9c3] pt-12">
              <h2 className="mb-5 font-sans text-3xl font-bold tracking-tight text-[#003527]"><span className="mr-3 text-[#2b6954]/50">02</span>Relationship</h2>
              <p>Please read the Terms carefully before you start to use the Website. By using the Website or by clicking to accept or agree to the Terms of Service when this option is made available to you, you accept and agree to be bound and abide by these Terms and our Privacy Policy, incorporated herein by reference. If you do not want to agree to these Terms or the Privacy Policy, you must not access or use the Website.</p>
            </section>
          </article>
        </main>
      </div>

      <footer className="border-t border-[#bfc9c3] bg-[#e3e3de] px-5 py-8 print:hidden">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <div><p className="font-extrabold text-[#003527]">PharmHelm Pro</p><p className="mt-1 text-xs text-[#5e5f5b]">© 2026 PharmHelm Pro. All rights reserved.</p></div>
          <div className="flex gap-5 text-sm font-semibold"><a className="text-[#5e5f5b] hover:text-[#003527]" href={publicUrl('privacy')}>Privacy Policy</a><span className="text-[#003527] underline">Terms of Service</span></div>
        </div>
      </footer>
    </div>
  );
};
