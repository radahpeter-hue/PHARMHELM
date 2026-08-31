import React, { useEffect } from 'react';
import { Download, Printer, X } from 'lucide-react';

const publicUrl = (subdomain: 'privacy' | 'www') => {
  const host = window.location.hostname.toLowerCase();
  if (host.includes('localhost') || host.includes('web.app') || host.includes('firebaseapp.com')) {
    return subdomain === 'privacy' ? '/privacy' : '/';
  }
  return subdomain === 'privacy' ? 'https://privacy.pharmhelm.com' : 'https://pharmhelm.com';
};

const sections = [
  {
    id: 'section-1',
    num: '01',
    title: 'Introduction',
    content: [
      'These Website Terms of Service (these "Terms") contained herein on this webpage govern your access to and use of this website, including any content, functionality, and services offered on or through this website (collectively, the "Website").',
      'The Website is operated by Radah Pharmaceutical Services Ltd. ("we", "us", or "our").',
    ],
  },
  {
    id: 'section-2',
    num: '02',
    title: 'Relationship',
    content: [
      'Please read the Terms carefully before you start to use the Website. By using the Website or by clicking to accept or agree to the Terms of Service when this option is made available to you, you accept and agree to be bound and abide by these Terms and our Privacy Policy, incorporated herein by reference. If you do not want to agree to these Terms or the Privacy Policy, you must not access or use the Website.',
    ],
  },
  {
    id: 'section-3',
    num: '03',
    title: 'Eligibility',
    content: [
      'This Website is offered and available to users who are 18 years of age or older and who reside in any country where access is not legally prohibited. By using this Website, you represent and warrant that you are of legal age to form a binding contract with us and meet all the foregoing eligibility requirements.',
      'If you do not meet all of these requirements, you must not access or use the Website.',
    ],
  },
  {
    id: 'section-4',
    num: '04',
    title: 'Changes to Terms',
    content: [
      'We may revise and update these Terms from time to time at our sole discretion. All changes are effective immediately when we post them and apply to all access to and use of the Website thereafter.',
      'Your continued use of the Website following the posting of revised Terms means that you accept and agree to the changes. You are expected to check this page from time to time so you are aware of any changes, as they are binding on you.',
    ],
  },
  {
    id: 'section-5',
    num: '05',
    title: 'Access & Security',
    content: [
      'We reserve the right to withdraw or amend this Website, and any service or material we provide on the Website, in our sole discretion without notice. We will not be liable if, for any reason, all or any part of the Website is unavailable at any time or for any period.',
      'You are responsible for ensuring that all persons who access the Website through your internet connection are aware of these Terms and comply with them. You are responsible for making all arrangements necessary for you to have access to the Website.',
      'To access the Website or some of the resources it offers, you may be asked to provide certain registration details or other information. It is a condition of your use of the Website that all the information you provide on the Website is correct, current, and complete.',
      'If you choose, or are provided with, a username, password, or any other piece of information as part of our security procedures, you must treat such information as confidential, and you must not disclose it to any other person or entity. You agree to notify us immediately of any unauthorised access to or use of your username or password or any other breach of security.',
    ],
  },
  {
    id: 'section-6',
    num: '06',
    title: 'Content Accuracy',
    content: [
      'The information presented on or through the Website is made available solely for general information purposes. We do not warrant the accuracy, completeness, or usefulness of this information. Any reliance you place on such information is strictly at your own risk.',
      'We disclaim all liability and responsibility arising from any reliance placed on such materials by you or any other visitor to the Website, or by anyone who may be informed of any of its contents.',
    ],
  },
  {
    id: 'section-7',
    num: '07',
    title: 'Medical Disclaimer',
    content: [
      'This Website may include content related to pharmaceutical inventory management, drug information, and healthcare administration. Such content is provided for informational purposes only and does not constitute medical or pharmaceutical advice.',
      'Nothing on this Website is intended to be a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of your physician or other qualified health provider with any questions you may have regarding a medical condition or medication.',
      'We are not responsible for any health decisions or actions taken based on information presented on this Website.',
    ],
  },
  {
    id: 'section-8',
    num: '08',
    title: 'Intellectual Property',
    content: [
      'The Website and its entire contents, features, and functionality (including but not limited to all information, software, text, displays, images, video, and audio, and the design, selection, and arrangement thereof) are owned by Radah Pharmaceutical Services Ltd., its licensors, or other providers of such material and are protected by Ugandan and international copyright, trademark, patent, trade secret, and other intellectual property or proprietary rights laws.',
      'These Terms permit you to use the Website for your personal, non-commercial use only. You must not reproduce, distribute, modify, create derivative works of, publicly display, publicly perform, republish, download, store, or transmit any of the material on our Website, except as generally and ordinarily permitted through the Website according to these Terms.',
    ],
  },
  {
    id: 'section-9',
    num: '09',
    title: 'User Content',
    content: [
      'The Website may contain message boards, chat rooms, personal web pages or profiles, forums, bulletin boards, and other interactive features that allow users to post, submit, publish, display, or transmit content or materials on or through the Website.',
      'All User Content must comply with the Content Standards set out in these Terms. Any User Content you post to the site will be considered non-confidential and non-proprietary. By providing any User Content on the Website, you grant us the right to use, reproduce, modify, perform, display, distribute, and otherwise disclose to third parties any such material for any purpose.',
    ],
  },
  {
    id: 'section-10',
    num: '10',
    title: 'Prohibited Uses',
    content: [
      'You may use the Website only for lawful purposes and in accordance with these Terms. You agree not to use the Website in any way that violates any applicable national or international law or regulation, for the purpose of exploiting, harming, or attempting to exploit or harm minors, to transmit any advertising or promotional material without our prior written consent, to impersonate or attempt to impersonate the Company or any other person or entity, or to engage in any other conduct that restricts or inhibits anyone\'s use or enjoyment of the Website.',
    ],
  },
  {
    id: 'section-11',
    num: '11',
    title: 'Copyright Infringement',
    content: [
      'If you believe that any User Content violates your copyright, please send us a notice of copyright infringement. It is our policy to terminate the user accounts of repeat infringers.',
    ],
  },
  {
    id: 'section-12',
    num: '12',
    title: 'User Information',
    content: [
      'All information we collect on this Website is subject to our Privacy Policy. By using the Website, you consent to all actions taken by us with respect to your information in compliance with the Privacy Policy.',
    ],
  },
  {
    id: 'section-13',
    num: '13',
    title: 'Online Purchases',
    content: [
      'All purchases through our site or other transactions for the sale of services or information formed through the Website, or resulting from visits made by you, are governed by our terms of sale, which are hereby incorporated into these Terms.',
      'Additional terms and conditions may also apply to specific portions, services, or features of the Website. All such additional terms and conditions are hereby incorporated by this reference into these Terms.',
    ],
  },
  {
    id: 'section-14',
    num: '14',
    title: 'Third-Party Links',
    content: [
      'If the Website contains links to other sites and resources provided by third parties, these links are provided for your convenience only. This includes links contained in advertisements, including banner advertisements and sponsored links. We have no control over the contents of those sites or resources, and accept no responsibility for them or for any loss or damage that may arise from your use of them.',
      'If you decide to access any of the third-party websites linked to this Website, you do so entirely at your own risk and subject to the terms and conditions of use for such websites.',
    ],
  },
  {
    id: 'section-15',
    num: '15',
    title: 'Geographic Restrictions',
    content: [
      'The owner of the Website is based in Uganda. We provide this Website for use primarily by persons located in East Africa. We make no claims that the Website or any of its content is accessible or appropriate outside of this region. Access to the Website may not be legal by certain persons or in certain countries.',
    ],
  },
  {
    id: 'section-16',
    num: '16',
    title: 'Warranties',
    content: [
      'You understand that we cannot and do not guarantee or warrant that files available for downloading from the internet or the Website will be free of viruses or other destructive code. You are responsible for implementing sufficient procedures and checkpoints to satisfy your particular requirements for anti-virus protection and accuracy of data input and output.',
      'TO THE FULLEST EXTENT PROVIDED BY LAW, WE WILL NOT BE LIABLE FOR ANY LOSS OR DAMAGE CAUSED BY A DISTRIBUTED DENIAL-OF-SERVICE ATTACK, VIRUSES, OR OTHER TECHNOLOGICALLY HARMFUL MATERIAL THAT MAY INFECT YOUR COMPUTER EQUIPMENT, COMPUTER PROGRAMS, DATA, OR OTHER PROPRIETARY MATERIAL.',
      'YOUR USE OF THE WEBSITE, ITS CONTENT, AND ANY SERVICES OR ITEMS OBTAINED THROUGH THE WEBSITE IS AT YOUR OWN RISK. THE WEBSITE, ITS CONTENT, AND ANY SERVICES OR ITEMS OBTAINED THROUGH THE WEBSITE ARE PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS, WITHOUT ANY WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.',
    ],
  },
  {
    id: 'section-17',
    num: '17',
    title: 'Limitation of Liability',
    content: [
      'TO THE FULLEST EXTENT PROVIDED BY LAW, IN NO EVENT WILL RADAH PHARMACEUTICAL SERVICES LTD., ITS AFFILIATES, OR THEIR LICENSORS, SERVICE PROVIDERS, EMPLOYEES, AGENTS, OFFICERS, OR DIRECTORS BE LIABLE FOR DAMAGES OF ANY KIND, UNDER ANY LEGAL THEORY, ARISING OUT OF OR IN CONNECTION WITH YOUR USE, OR INABILITY TO USE, THE WEBSITE, ANY WEBSITES LINKED TO IT, ANY CONTENT ON THE WEBSITE OR SUCH OTHER WEBSITES, INCLUDING ANY DIRECT, INDIRECT, SPECIAL, INCIDENTAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES.',
    ],
  },
  {
    id: 'section-18',
    num: '18',
    title: 'Indemnification',
    content: [
      'You agree to defend, indemnify, and hold harmless Radah Pharmaceutical Services Ltd., its affiliates, licensors, and service providers, and its and their respective officers, directors, employees, contractors, agents, licensors, suppliers, successors, and assigns from and against any claims, liabilities, damages, judgments, awards, losses, costs, expenses, or fees (including reasonable legal fees) arising out of or relating to your violation of these Terms or your use of the Website.',
    ],
  },
  {
    id: 'section-19',
    num: '19',
    title: 'Governing Law',
    content: [
      'All matters relating to the Website and these Terms, and any dispute or claim arising therefrom or related thereto, shall be governed by and construed in accordance with the laws of the Republic of Uganda, without giving effect to any choice or conflict of law provision or rule.',
    ],
  },
  {
    id: 'section-20',
    num: '20',
    title: 'Arbitration',
    content: [
      'Any dispute, claim or controversy arising out of or relating to these Terms, including the determination of the scope or applicability of these Terms to arbitrate, shall be determined by arbitration in Kampala, Uganda. The arbitration shall be administered in accordance with the Arbitration and Conciliation Act of Uganda.',
      'The arbitrator\'s award shall be binding and may be entered as a judgment in any court of competent jurisdiction.',
    ],
  },
  {
    id: 'section-21',
    num: '21',
    title: 'Class Action Waiver',
    content: [
      'ANY PROCEEDINGS TO RESOLVE OR LITIGATE ANY DISPUTE IN ANY FORUM WILL BE CONDUCTED SOLELY ON AN INDIVIDUAL BASIS. NEITHER YOU NOR WE WILL SEEK TO HAVE ANY DISPUTE HEARD AS A CLASS ACTION OR IN ANY OTHER PROCEEDING IN WHICH EITHER PARTY ACTS OR PROPOSES TO ACT IN A REPRESENTATIVE CAPACITY.',
      'No arbitration or proceeding will be combined with another without the prior written consent of all parties to all affected arbitrations or proceedings.',
    ],
  },
  {
    id: 'section-22',
    num: '22',
    title: 'Limitation on Time',
    content: [
      'ANY CAUSE OF ACTION OR CLAIM YOU MAY HAVE ARISING OUT OF OR RELATING TO THESE TERMS OR THE WEBSITE MUST BE COMMENCED WITHIN ONE (1) YEAR AFTER THE CAUSE OF ACTION ACCRUES; OTHERWISE, SUCH CAUSE OF ACTION OR CLAIM IS PERMANENTLY BARRED.',
    ],
  },
  {
    id: 'section-23',
    num: '23',
    title: 'Waiver & Severability',
    content: [
      'No waiver by the Company of any term or condition set out in these Terms shall be deemed a further or continuing waiver of such term or condition or a waiver of any other term or condition, and any failure of the Company to assert a right or provision under these Terms shall not constitute a waiver of such right or provision.',
      'If any provision of these Terms is held by a court or other tribunal of competent jurisdiction to be invalid, illegal, or unenforceable for any reason, such provision shall be eliminated or limited to the minimum extent such that the remaining provisions of the Terms will continue in full force and effect.',
    ],
  },
  {
    id: 'section-24',
    num: '24',
    title: 'SMS/Text Communications',
    content: [
      'PharmHelm Pro may send SMS or text notifications related to your account, transactions, or service updates. By providing your phone number, you consent to receive such communications.',
      'You may opt out of promotional SMS messages at any time by following the unsubscribe instructions provided in the message or by contacting us directly. Standard messaging rates may apply.',
    ],
  },
  {
    id: 'section-25',
    num: '25',
    title: 'Force Majeure',
    content: [
      'We shall not be liable for any failure or delay in performing our obligations under these Terms where such failure or delay results from any cause that is beyond our reasonable control, including but not limited to acts of God, fire, flood, earthquake, pandemic, epidemic, governmental actions, war, terrorism, cyber-attacks, internet outages, or any other force majeure event.',
    ],
  },
  {
    id: 'section-26',
    num: '26',
    title: 'Entire Agreement',
    content: [
      'These Terms, our Privacy Policy, and any terms of sale constitute the sole and entire agreement between you and Radah Pharmaceutical Services Ltd. regarding the Website and supersede all prior and contemporaneous understandings, agreements, representations, and warranties, both written and oral, regarding the Website.',
    ],
  },
  {
    id: 'section-27',
    num: '27',
    title: 'Complaints',
    content: [
      'If you have any complaints about the Website or the services provided, please contact us using the details provided in Section 28 below. We will endeavour to acknowledge your complaint within 48 hours and resolve it within a reasonable timeframe.',
    ],
  },
  {
    id: 'section-28',
    num: '28',
    title: 'Contact Us',
    content: [
      'To ask questions or comment about these Terms and our privacy practices, contact us at:',
      'Radah Pharmaceutical Services Ltd.\nPlot 28, Bombo Road\nKampala, Uganda\nEmail: legal@pharmhelm.com',
    ],
  },
];

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
        <aside className="sticky top-20 hidden h-[calc(100vh-5rem)] w-72 shrink-0 overflow-y-auto border-r border-[#bfc9c3] px-8 py-10 md:block print:hidden">
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.18em] text-[#5e5f5b]">Document index</p>
          <nav className="space-y-1 text-sm font-semibold">
            <a href="#metadata" className="block border-l-2 border-transparent px-4 py-2 text-[#5e5f5b] hover:border-[#003527] hover:bg-[#f0eded] hover:text-[#003527]">Document metadata</a>
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="block border-l-2 border-transparent px-4 py-1.5 text-[13px] text-[#5e5f5b] hover:border-[#003527] hover:bg-[#f0eded] hover:text-[#003527]">
                {s.num.replace(/^0/, '')}. {s.title}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-5 py-12 sm:px-10 md:px-16 md:py-16 lg:px-24">
          <section id="metadata" className="scroll-mt-28 border-b border-[#bfc9c3] pb-10">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#2b6954]">Legal</p>
            <h1 className="mb-8 text-4xl font-extrabold tracking-tight text-[#003527] sm:text-5xl md:text-6xl">Website Terms of Service</h1>
            <div className="grid gap-5 rounded-2xl border border-[#bfc9c3] bg-white p-6 sm:grid-cols-2">
              <div><p className="text-xs font-bold uppercase tracking-widest text-[#5e5f5b]">Version</p><p className="mt-1 text-xl font-bold">1.0</p></div>
              <div><p className="text-xs font-bold uppercase tracking-widest text-[#5e5f5b]">Effective date</p><p className="mt-1 text-xl font-bold">18th August 2026</p></div>
              <div className="sm:col-span-2"><p className="text-xs font-bold uppercase tracking-widest text-[#5e5f5b]">Provider</p><p className="mt-1 font-semibold">Radah Pharmaceutical Services Ltd.</p></div>
            </div>
          </section>

          <article className="space-y-14 py-12 font-serif text-lg leading-8 text-[#404944] md:text-xl">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} className={`scroll-mt-28 ${i > 0 ? 'border-t border-[#bfc9c3] pt-12' : ''}`}>
                <h2 className="mb-5 font-sans text-3xl font-bold tracking-tight text-[#003527]">
                  <span className="mr-3 text-[#2b6954]/50">{s.num}</span>{s.title}
                </h2>
                {s.content.map((p, j) => (
                  <p key={j} className={j < s.content.length - 1 ? 'mb-5' : ''} style={p.includes('\n') ? { whiteSpace: 'pre-line' } : undefined}>{p}</p>
                ))}
              </section>
            ))}
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
