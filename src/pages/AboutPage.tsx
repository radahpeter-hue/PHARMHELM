import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { 
  ShoppingCart, 
  Truck, 
  TrendingUp, 
  CheckCircle, 
  UserCheck, 
  ShieldCheck 
} from 'lucide-react';

export const AboutPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Three.js Scene Setup for 3D Capsule
    const container = containerRef.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0x95d3ba, 1.2);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);
    
    const pointLight = new THREE.PointLight(0x95d3ba, 1, 10);
    pointLight.position.set(-5, -5, 2);
    scene.add(pointLight);

    // Creating Capsule Geometry
    const capsuleGroup = new THREE.Group();
    
    const topGeom = new THREE.SphereGeometry(1, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const topMat = new THREE.MeshPhongMaterial({ color: 0x95d3ba, shininess: 100, transparent: true, opacity: 0.95 });
    const top = new THREE.Mesh(topGeom, topMat);
    top.position.y = 1;
    
    const bottomGeom = new THREE.SphereGeometry(1, 32, 32, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const bottomMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 100, transparent: true, opacity: 0.95 });
    const bottom = new THREE.Mesh(bottomGeom, bottomMat);
    bottom.position.y = -1;
    
    const midTopGeom = new THREE.CylinderGeometry(1, 1, 1, 32);
    const midMatTop = new THREE.MeshPhongMaterial({ color: 0x95d3ba, shininess: 100, transparent: true, opacity: 0.95 });
    const midTop = new THREE.Mesh(midTopGeom, midMatTop);
    midTop.position.y = 0.5;
    
    const midBottomGeom = new THREE.CylinderGeometry(1, 1, 1, 32);
    const midMatBottom = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 100, transparent: true, opacity: 0.95 });
    const midBottom = new THREE.Mesh(midBottomGeom, midMatBottom);
    midBottom.position.y = -0.5;

    capsuleGroup.add(top);
    capsuleGroup.add(bottom);
    capsuleGroup.add(midTop);
    capsuleGroup.add(midBottom);
    
    scene.add(capsuleGroup);
    capsuleGroup.rotation.z = Math.PI / 6; 
    camera.position.z = 6;

    // Animation & Interaction Loop
    let currentScrollY = 0;
    let animationId: number;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      
      // Smooth scroll interpolation
      currentScrollY += (window.scrollY - currentScrollY) * 0.1;
      const scrollPercent = currentScrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      
      // Capsule animation
      capsuleGroup.rotation.y = scrollPercent * Math.PI * 6;
      capsuleGroup.rotation.x = Math.sin(Date.now() * 0.0005) * 0.2;
      capsuleGroup.position.y = Math.sin(Date.now() * 0.001) * 0.3;
      
      // Camera Reactivity
      camera.position.y = -scrollPercent * 2;
      
      // "Pop-out" glass pallets logic
      const glassPanels = document.querySelectorAll('.glass-panel');
      const viewportCenter = window.innerHeight / 2;
      
      glassPanels.forEach(panel => {
        const rect = panel.getBoundingClientRect();
        const panelCenter = rect.top + rect.height / 2;
        const distFromCenter = Math.abs(panelCenter - viewportCenter);
        
        if (distFromCenter < 300) {
          panel.classList.add('active-focus');
        } else {
          panel.classList.remove('active-focus');
        }
      });

      renderer.render(scene, camera);
    };
    
    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const x = (window.innerWidth / 2 - e.clientX) / 60;
      const y = (window.innerHeight / 2 - e.clientY) / 60;
      
      document.querySelectorAll('.parallax-subtle').forEach(el => {
        (el as HTMLElement).style.transform = `translate(${x}px, ${y}px)`;
      });
      
      capsuleGroup.position.x = -x * 0.05;
      capsuleGroup.position.z = -y * 0.05;
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="bg-[#05192d] text-white selection:bg-[#b0f0d6] selection:text-[#003527] overflow-x-hidden min-h-screen relative font-sans">
      {/* 3D Capsule Background */}
      <div id="capsule-container" ref={containerRef} className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[50vh] h-[50vh] bg-[radial-gradient(circle,rgba(149,211,186,0.2)_0%,transparent_75%)] rounded-full animate-pulse blur-[30px] opacity-50"></div>
      </div>

      <header className="w-full top-0 bg-black/10 backdrop-blur-xl border-b border-white/10 z-50 sticky">
        <div className="flex justify-between items-center px-6 md:px-16 py-5 max-w-7xl mx-auto">
          <span className="text-xl md:text-2xl font-extrabold text-[#95d3ba] tracking-tighter">PharmHelm Pro</span>
          <div className="flex items-center gap-6">
            <a className="text-white text-sm hover:text-[#95d3ba] transition-colors duration-300" href="#built-by-pharmacist">About</a>
            <a className="px-5 py-2.5 bg-[#064e3b] text-white text-xs font-bold transition-all hover:brightness-125 hover:shadow-lg rounded border border-white/10" href="mailto:pharmhelmpro@gmail.com">Contact Us</a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 md:px-16 relative z-10">
        {/* Section 1: Hero */}
        <section className="py-20 flex flex-col md:flex-row items-center gap-12 min-h-[85vh]">
          <div className="flex-1 space-y-6">
            <h1 className="text-4xl md:text-6xl font-black text-white max-w-3xl leading-[1.05] tracking-tight">Eased Operation, eased oversight. Anytime, Anywhere.</h1>
            <p className="text-lg md:text-xl text-white/90 max-w-xl leading-relaxed font-semibold">
              PharmHelm Pro is a premier management ecosystem architected for multi-branch retail pharmacies in Uganda.
            </p>
            <div className="h-[1px] bg-gradient-to-r from-transparent via-[#95d3ba]/60 to-transparent w-full max-w-sm mt-8"></div>
          </div>
          <div className="flex-1 flex justify-center items-center">
            <div className="relative group w-full max-w-2xl">
              <div className="absolute -inset-8 bg-[#95d3ba]/20 blur-[100px] opacity-40 group-hover:opacity-70 transition-opacity"></div>
              <img 
                alt="System Dashboard" 
                className="w-full rounded-xl border border-white/25 bg-white/5 backdrop-blur shadow-2xl transition-all duration-500 parallax-subtle" 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAOjix0sWoX6WA-M_xlC2jdekxiA1GO03syHK680ZBxPNByP-9L8P7EopdVkXEVfNXwRbEm85WGHoEyVIwUYVx55Z4-86xomYawxjq3bQCGzuP0NHp-LQSYW75Y7g7MFf4S8nFOiTthUTwWEmXaxup60apYshBnccoSZHCkDD37REtweqUIvmzKga_JB_Rb1c0nsI1VxmW_DM-Aru8kiJuIJUwyBvxajFu2SejEpwYyIOTNWhYog3_kFM6SGE_ar5137Hg"
              />
            </div>
          </div>
        </section>

        {/* Section 2: Operational Ecosystem */}
        <section className="py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            <div className="lg:col-span-4">
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#95d3ba] sticky top-32 drop-shadow-sm">Operational Ecosystem</h2>
              <p className="text-lg md:text-xl italic border-l-4 border-[#95d3ba] pl-6 mt-10 text-white/90 font-medium">
                A connected framework designed to eliminate the friction of multi-branch oversight.
              </p>
            </div>
            <div className="lg:col-span-8 space-y-10">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
                {/* POS */}
                <div className="space-y-8">
                  <div className="p-8 border border-white/10 bg-white/5 backdrop-blur rounded-xl space-y-5 shadow transition-all hover:scale-102">
                    <ShoppingCart size={48} className="text-[#95d3ba]" />
                    <h3 className="text-xl md:text-2xl text-white font-bold">Point of Sale</h3>
                    <p className="text-white/80 font-medium">Real-time transaction processing with deep integration into financial reporting and compliance.</p>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-white/15 bg-white/5 backdrop-blur group">
                    <img 
                      alt="Point of Sale Interface" 
                      className="w-full h-auto opacity-95 transition-transform duration-700 group-hover:scale-105" 
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuCZnOYGvUuEqNMgFwR_PTb_zBwZnu781h-nwFeqnho0kD3ZPLBGatdx4b3-ZxozPMTCUVPtBG5wfDNJTJI951hDVkc0K4YWmkQ58ktsXoGckldLA8Zo2V-JNLWn-wpWsv-fpYpmaR4geLIHpNa8KURROXrjdekXVj8RGiYr6gqHgJ_3l646mhN2UvKANCh8JqGXQsjaUJt2cbbTZLgzkHmde-aalMVcqsDmn69LIUkBRXd31OhU07PLROgvr2JG4r5D24s"
                    />
                    <div className="p-6 border-l-4 border-[#95d3ba] bg-white/10 backdrop-blur -mt-6 mx-4 mb-6 relative z-10 rounded-lg shadow-xl">
                      <p className="text-[11px] font-black text-[#95d3ba] mb-2 uppercase tracking-widest">SYSTEM INSIGHT</p>
                      <p className="text-xs text-white font-medium">Real-time batch tracking ensures immediate visibility into active stock levels across regions.</p>
                    </div>
                  </div>
                </div>
                {/* Procurement */}
                <div className="space-y-8 lg:mt-24">
                  <div className="p-8 border border-white/10 bg-white/5 backdrop-blur rounded-xl space-y-5 shadow transition-all hover:scale-102">
                    <Truck size={48} className="text-[#95d3ba]" />
                    <h3 className="text-xl md:text-2xl text-white font-bold">Procurement</h3>
                    <p className="text-white/80 font-medium">Centralized sourcing and branch fulfillment modules to manage supplier relations at scale.</p>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-white/15 bg-white/5 backdrop-blur group">
                    <img 
                      alt="Procurement Interface" 
                      className="w-full h-auto opacity-95 transition-transform duration-700 group-hover:scale-105" 
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuDAT57EPl_RWoEB91kUeHeT-2qYoXAviZQl1Buq1SfAPDCcnL5kl1qwWoGp90C8-gDmEHDnelOZeNxWCliL2IYdt7leWoRiOdbf5EJ-jNb5dLn0-Uo-DkUKJgVPUK8JK4X95OUJOeHxuUB9OTbN8zD2bUsfBULoLGMX6SMxIH86FJPat1h0CriFhcMxlJsXE-IL4Cxgi2Y_qRjIwg7YEJbKVDLXRa1U4ecBs5T9k45FCLebD6JEs8n5zIRQv69iUSggYEI"
                    />
                    <div className="p-6 border-l-4 border-[#95d3ba] bg-white/10 backdrop-blur -mt-6 mx-4 mb-6 relative z-10 rounded-lg shadow-xl">
                      <p className="text-[11px] font-black text-[#95d3ba] mb-2 uppercase tracking-widest">HQ OVERSIGHT</p>
                      <p className="text-xs text-white font-medium">Central store matrices isolated from local operations for clean regulatory reporting.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Till & Inventory */}
        <section className="py-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-20 items-center mb-20">
            <div className="space-y-6">
              <span className="text-xs font-bold text-[#95d3ba] uppercase tracking-widest px-4 py-2 bg-white/10 rounded-full inline-block border border-white/5">Efficiency at point of care</span>
              <h2 className="text-3xl md:text-4xl font-extrabold text-white">At the till</h2>
              <p className="text-base md:text-lg text-white/90 max-w-md font-semibold">
                Sales behavior is governed by strict FEFO (First-Expiry, First-Out) logic, ensuring stock integrity is maintained at every transaction.
              </p>
              <div className="space-y-5 pt-6 border-l-4 border-[#95d3ba]/50 pl-6 text-sm">
                <div className="flex items-start gap-4">
                  <span className="w-3 h-3 bg-[#95d3ba] mt-2 rounded-full"></span>
                  <p className="text-white font-bold">FEFO Automated Logic: Prioritizing older batches at checkout.</p>
                </div>
                <div className="flex items-start gap-4">
                  <span className="w-3 h-3 bg-[#95d3ba] mt-2 rounded-full"></span>
                  <p className="text-white font-bold">Inventory Master: SKU level pricing and tax classification.</p>
                </div>
              </div>
            </div>
            <div className="border border-white/15 bg-white/5 backdrop-blur rounded-xl overflow-hidden p-3 shadow-2xl">
              <img alt="Inventory Master View" className="w-full h-auto rounded-lg" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBjilpZIJ0LSeD2DNJL-LmZRouHWVe2GNAFj6l2hPsE9e3rhrb2gJZFMdBIktClvTUXGnfhKmflbUMu-sRwUUg4iNbmRkujB5EOhWYn3Mdenke26ToocNFahE4JGJ2zU69rCq5AqeF5GZPJ0aI-UcBUYbQ2p40HXzG1SmuavnisvfsPVnsRbGK-SLuCguSB6suv72LoPYpH8k_LUj9sSgXgne9pc43lkRxU59VMzC6y_BcLhcWC9SS2b_jaD2fsYG3uNg4" />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-20 items-center">
            <div className="md:order-2 space-y-6">
              <span className="text-xs font-bold text-[#95d3ba] uppercase tracking-widest px-4 py-2 bg-white/10 rounded-full inline-block border border-white/5">Clinical Logistics</span>
              <h2 className="text-3xl md:text-4xl font-extrabold text-white">Inventory</h2>
              <p className="text-base md:text-lg text-white/90 max-w-md font-semibold">
                Batch tracking is the core of our inventory philosophy. PharmHelm Pro monitors batch-specific movement and provides proactive expiry flags.
              </p>
              <div className="h-[1px] bg-gradient-to-r from-transparent via-[#95d3ba]/60 to-transparent w-full max-w-xs my-6"></div>
              <p className="text-xs text-[#95d3ba] italic font-bold">
                "Visual proof of systemic discipline: New requisitions are tracked from submission to financial approval."
              </p>
            </div>
            <div className="md:order-1 border border-white/15 bg-white/5 backdrop-blur rounded-xl overflow-hidden p-3 shadow-2xl">
              <img alt="Requisition Management" className="w-full h-auto rounded-lg" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAcEyKyOgPckVPKmo8ftBE677Z8miwKaYI7AUQlmGW349V9vVNsMD44uGq1djXuTgkAaYodHShzr0VImPSDw0dZwgTTDp3VEItLodgie_hdcHJF2e0LYgzodJe4jOn3JKKgdAGNQA7c_bJ_dKEBoQA2q663Lqdxjtkf-TMxMAy9QUfuMBsZzSvqDUW2TgJ64Zc3F3y22QbNCRHNfbY9JuU7Nuufiqc7fnBV4I9uFSloRp6gf9E8YwjQEtcRhM4ODeJ6dmE" />
            </div>
          </div>
        </section>

        {/* Section 4: Predictive Engine */}
        <section className="py-20">
          <div className="border border-white/35 bg-white/5 backdrop-blur rounded-3xl p-8 md:p-16 overflow-hidden relative shadow-2xl">
            <div className="absolute top-0 right-0 p-16 opacity-10 hidden md:block">
              <TrendingUp size={200} className="text-[#95d3ba]" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center relative z-10">
              <div className="space-y-8">
                <h2 className="text-3xl md:text-4xl font-extrabold text-[#95d3ba] tracking-tight">Predictive &amp; Diagnostic Engine</h2>
                <p className="text-base md:text-lg text-white leading-relaxed font-bold">
                  Moving beyond simple records, PharmHelm Pro identifies sales gaps, inventory turnover rates, and sustainability signals to guide management decisions.
                </p>
                <div className="flex flex-wrap gap-4 pt-4 text-xs font-bold">
                  <div className="px-5 py-2.5 bg-white/15 backdrop-blur rounded-full border border-white/30 shadow-md">Sales Gap Analysis</div>
                  <div className="px-5 py-2.5 bg-white/15 backdrop-blur rounded-full border border-white/30 shadow-md">Sustainability Signals</div>
                </div>
              </div>
              <div className="rounded-xl overflow-hidden shadow-2xl border border-white/30">
                <img alt="Predictive Engine" className="w-full h-auto" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCpZuQUgf2u7dVJ4nP1HDpMn47F8pp_JbaEsow675Va9Xafb4Rv-Z2WKIQWExw5p1F-5kEVtX2KiXgcveZzxASUc-J7DZLa3CNvkyZaG-Hb6AqlZnssILpiQuH4m86rB15uYqbFY_9TkICMNLdqiYGKPgw_LchjWrvA-ZGcwMGhcmycVMigOjASzVzEg64SZmDrp6Yf9d04O3g-K8ey6jqRxXLN0ImGXIz_pSfBcqtkwO3AHJGJOlQEx4FHrvXSoscIyQU" />
              </div>
            </div>
          </div>
        </section>

        {/* Section 5: Finance */}
        <section className="py-20">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-12 items-center">
            <div className="md:col-span-5 space-y-6">
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#95d3ba]">Finance &amp; Oversight</h2>
              <p className="text-base md:text-lg text-white font-bold">
                Daily reconciliation happens automatically. PharmHelm Pro provides granular margin tracking, allowing owners to see exactly where profit is generated.
              </p>
              <div className="p-8 border border-white/15 bg-white/5 backdrop-blur rounded-xl transition-all">
                <h4 className="text-xs font-extrabold text-[#95d3ba] mb-3 uppercase tracking-widest">Branch Performance</h4>
                <p className="text-base md:text-lg text-white italic font-bold">A diagnostic view of each branch... classifications based on turnover and costs.</p>
              </div>
            </div>
            <div className="md:col-span-7 flex justify-end w-full">
              <div className="w-full max-w-2xl border border-white/15 bg-white/5 backdrop-blur rounded-xl overflow-hidden p-3 shadow-2xl">
                <img alt="Finance Dashboard" className="w-full h-auto rounded-lg shadow-sm" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA7w-hLnxGKR1qBPQs2qsk3ac10QZBJMHgTBJHYEu4W-qYIj2v-EtpemsVbGt3H7Q69KMDtfAH3qeMcY_0kn1kWpiP6dsRuLRRNLQWN3HoefGEnEtjemhZ66NTW58HUxhdf4v9JCJN2v1H6sZbLToXTjel9smvEDw9Np_3j5YNisg6oNEZpub8Cvn8UlNXJGot7pRNG5oNgVVX2ArUx3liXE-LhCh_0Z10RLz-jyPrfcdS_DMw-LHNbfj7OpjVfuV01vsg" />
              </div>
            </div>
          </div>
        </section>

        {/* Section 6: Compliance & HR */}
        <section className="py-20 border-t border-white/20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-20">
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#95d3ba]">Compliance &amp; QA</h2>
              <div className="border border-white/15 bg-white/5 backdrop-blur rounded-xl overflow-hidden mb-8">
                <img alt="Compliance Dashboard" className="w-full h-auto opacity-100" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBZQThKfbt3JjwFgGYRZo5zAtImLnbY477GZnCRkqPKoqFd3MVyLOGaQso2xzfoE-0-dWHTEgReJjKc6GQVb_SvFOzo-q0Pd8NRZrg-y4PKCWvgds0uw1GNyVXOp_YS_QZTQ2vb9xqR72yPS3UkTSVVbd7PwIUXmcUfTZpUPz2y4taGocAB5TQiJ-TAEbfN6KPWO2mMW9-pAwFMyUYXwbgvBqySSkPmek_Yyc6jmzH5ZFLvRTXMH3iFSwSRqPU4TLyyPBA" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm font-bold">
                <div className="space-y-3 p-5 bg-white/5 rounded-lg border border-white/10">
                  <p className="text-[#95d3ba] font-extrabold">NDA LOGGING</p>
                  <p className="text-white text-xs">Automated record keeping for regulatory inspections and reporting requirements.</p>
                </div>
                <div className="space-y-3 p-5 bg-white/5 rounded-lg border border-white/10">
                  <p className="text-[#95d3ba] font-extrabold">COLD-CHAIN LOGS</p>
                  <p className="text-white text-xs">Secure digital records for temperature-sensitive inventory monitoring.</p>
                </div>
              </div>
              <div className="mt-8 space-y-4">
                <p className="text-xs font-extrabold text-[#95d3ba] uppercase tracking-widest">Branch Cleaning Checklist</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 border border-white/10 bg-white/5 rounded-lg space-y-2">
                    <div className="flex justify-between items-center text-[#95d3ba] text-xs">
                      <CheckCircle size={16} />
                      <span className="text-[10px] px-2 py-0.5 bg-[#95d3ba]/20 rounded-full uppercase font-bold">Completed</span>
                    </div>
                    <p className="text-white font-bold">Cleaning Walls and Ceiling</p>
                    <p className="text-white/70 text-xs">Frequency: Weekly</p>
                  </div>
                  <div className="p-4 border border-white/10 bg-white/5 rounded-lg space-y-2">
                    <div className="flex justify-between items-center text-[#95d3ba] text-xs">
                      <CheckCircle size={16} />
                      <span className="text-[10px] px-2 py-0.5 bg-[#95d3ba]/20 rounded-full uppercase font-bold">Completed</span>
                    </div>
                    <p className="text-white font-bold">Sweeping and Mopping</p>
                    <p className="text-white/70 text-xs">Frequency: Daily</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#95d3ba]">HR &amp; Welfare</h2>
              <div className="border border-white/15 bg-white/5 backdrop-blur rounded-xl overflow-hidden mb-8">
                <img alt="HR Portal" className="w-full h-auto opacity-100" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDw8qA0B8FDCSrxLvb2FfQRiNJijiG7GL2STL4Ys0_lrs9UEAqfSiuLdOuJjPbHXt8gHXUKXpnenVUrsVs9QY6E9yjFW764SBjIr-Pju80mUdTyx61XiuClirq9Qjuy89F_a80CYsHwIsxNsR1qWPEoP7eHRWEUEV7HtGz2UYR6JPPqA9CpEIoCmbLizgjiw00Srt3hgLbFkDW_t1LOj3Tyix1mPO0PSEvYdCfEmNxscnzoRgBsJYM9IEg_pHp5eddpYhE" />
              </div>
              <div className="border border-white/15 bg-white/5 backdrop-blur rounded-xl p-8 flex items-center gap-6 shadow">
                <div className="p-4 bg-[#064e3b] rounded-full shadow-lg text-white">
                  <UserCheck size={32} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-white mb-1">Employee Self-Service</p>
                  <p className="text-xs text-white/90 font-bold">Digital portal for leave, advances, and professional records.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 8: Scope */}
        <section className="py-20">
          <div className="border border-white/30 bg-white/5 backdrop-blur rounded-3xl p-8 md:p-16 flex flex-col md:flex-row gap-12 items-center shadow-2xl">
            <div className="md:w-1/3 flex justify-center">
              <div className="relative">
                <div className="absolute inset-0 bg-[#95d3ba]/30 blur-3xl rounded-full"></div>
                <ShieldCheck size={100} className="text-[#95d3ba] relative" />
              </div>
            </div>
            <div className="md:w-2/3 space-y-6">
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#95d3ba] tracking-tight">Scope of System</h2>
              <p className="text-base md:text-lg leading-relaxed text-white font-bold">
                PharmHelm Pro manages a pharmacy’s records and daily operations. It does not provide clinical decision support; it is a tool for professional pharmacists to exercise their clinical judgment with superior data visibility.
              </p>
            </div>
          </div>
        </section>

        {/* Section 9: Pharmacist founder footer banner */}
        <section className="py-20 flex flex-col items-center text-center space-y-6" id="built-by-pharmacist">
          <div className="h-[1px] bg-gradient-to-r from-transparent via-[#95d3ba]/60 to-transparent w-full max-w-md"></div>
          <p className="text-base md:text-lg text-white/90 max-w-xl mx-auto font-bold leading-relaxed">
            PharmHelm Pro was built from the ground up to solve the real-world operational challenges of managing multiple branches in a high-demand environment.
          </p>
          <div className="h-[1px] bg-gradient-to-r from-transparent via-[#95d3ba]/60 to-transparent w-full max-w-md"></div>
        </section>
      </main>

      <footer className="w-full bg-black/30 backdrop-blur-3xl border-t border-white/20 mt-20" id="contact">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center px-6 md:px-16 py-16 max-w-7xl mx-auto gap-10">
          <div className="space-y-6">
            <span className="text-xl md:text-2xl font-extrabold text-[#95d3ba] tracking-tighter">PharmHelm Pro</span>
            <p className="text-xs text-white/70 font-bold">© 2026 PharmHelm Pro. Built for Authority. All rights reserved.</p>
          </div>
          <div className="flex flex-col md:flex-row gap-12">
            <div className="space-y-3">
              <p className="text-[11px] font-extrabold text-[#95d3ba] uppercase tracking-[0.2em]">Inquiries</p>
              <a className="text-white hover:text-[#95d3ba] transition-all duration-300 font-bold text-xl" href="mailto:pharmhelmpro@gmail.com">pharmhelmpro@gmail.com</a>
            </div>
            <div className="space-y-4">
              <p className="text-[11px] font-extrabold text-[#95d3ba] uppercase tracking-[0.2em]">Compliance</p>
              <div className="flex flex-wrap gap-4 text-xs font-bold text-white/80">
                <a className="hover:text-white transition-colors" href="/privacy">Privacy Policy</a>
                <span className="text-white/20">|</span>
                <span className="text-white/50 cursor-default">Terms of Service</span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
