import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ThreeCapsuleProps {
  brandColor?: string;
  isLoggingIn?: boolean;
  onAnimationComplete?: () => void;
}

export const ThreeCapsule: React.FC<ThreeCapsuleProps> = ({
  brandColor = '#0c5252',
  isLoggingIn = false,
  onAnimationComplete,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationFrameId = useRef<number | null>(null);

  // Keep references to state values to avoid recreating the Three.js scene
  const isLoggingInRef = useRef(isLoggingIn);
  const onAnimationCompleteRef = useRef(onAnimationComplete);

  useEffect(() => {
    isLoggingInRef.current = isLoggingIn;
  }, [isLoggingIn]);

  useEffect(() => {
    onAnimationCompleteRef.current = onAnimationComplete;
  }, [onAnimationComplete]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 300;
    const height = container.clientHeight || 240;

    // Create scene
    const scene = new THREE.Scene();

    // Create camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 4.2;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0xffffff, 0.5, 10);
    pointLight.position.set(-3, 3, 3);
    scene.add(pointLight);

    // Capsule Group
    const capsuleGroup = new THREE.Group();
    const radius = 0.6;
    const height_half = 0.8;

    // Convert brand hex string to THREE.Color
    const capsulePrimaryColor = new THREE.Color(brandColor);

    // Top Half (Teal/Primary)
    const topGeom = new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const topCyl = new THREE.CylinderGeometry(radius, radius, height_half, 32, 1, true);
    topGeom.translate(0, height_half / 2, 0);
    topCyl.translate(0, 0, 0);

    const topMaterial = new THREE.MeshPhongMaterial({
      color: capsulePrimaryColor,
      shininess: 120,
      specular: new THREE.Color(0x333333),
    });

    const topHalf = new THREE.Group();
    const topSphereMesh = new THREE.Mesh(topGeom, topMaterial);
    const topCylMesh = new THREE.Mesh(topCyl, topMaterial);
    topHalf.add(topSphereMesh);
    topHalf.add(topCylMesh);
    topHalf.position.y = height_half / 2;
    capsuleGroup.add(topHalf);

    // Bottom Half (White/Surface)
    const bottomGeom = new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const bottomCyl = new THREE.CylinderGeometry(radius, radius, height_half, 32, 1, true);
    bottomGeom.translate(0, -height_half / 2, 0);
    bottomCyl.translate(0, 0, 0);

    const bottomMaterial = new THREE.MeshPhongMaterial({
      color: 0xfbf9f8,
      shininess: 120,
      specular: new THREE.Color(0x111111),
    });

    const bottomHalf = new THREE.Group();
    const bottomSphereMesh = new THREE.Mesh(bottomGeom, bottomMaterial);
    const bottomCylMesh = new THREE.Mesh(bottomCyl, bottomMaterial);
    bottomHalf.add(bottomSphereMesh);
    bottomHalf.add(bottomCylMesh);
    bottomHalf.position.y = -height_half / 2;
    capsuleGroup.add(bottomHalf);

    scene.add(capsuleGroup);

    // Mouse Tracking
    let mouseX = 0;
    let mouseY = 0;
    let targetRotationX = 0.3; // Give it a slight default tilt
    let targetRotationY = 0.5;

    const handleMouseMove = (event: MouseEvent) => {
      mouseX = (event.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
      targetRotationY = mouseX * 0.8;
      targetRotationX = -mouseY * 0.8 + 0.3; // keep baseline tilt
    };

    window.addEventListener('mousemove', handleMouseMove);

    // Touch support for mobile interaction
    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 0) {
        const touch = event.touches[0];
        mouseX = (touch.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(touch.clientY / window.innerHeight) * 2 + 1;
        targetRotationY = mouseX * 0.8;
        targetRotationX = -mouseY * 0.8 + 0.3;
      }
    };
    window.addEventListener('touchmove', handleTouchMove);

    // Resize Observer to keep size fluid
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width: w, height: h } = entries[0].contentRect;
      if (w && h) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    // Animation Loop
    const animate = () => {
      animationFrameId.current = requestAnimationFrame(animate);

      if (!isLoggingInRef.current) {
        // Smooth interpolation for mouse tracking
        capsuleGroup.rotation.y += (targetRotationY - capsuleGroup.rotation.y) * 0.08;
        capsuleGroup.rotation.x += (targetRotationX - capsuleGroup.rotation.x) * 0.08;
        
        // Subtle idle floating up and down
        capsuleGroup.position.y = Math.sin(Date.now() * 0.0015) * 0.12;
      } else {
        // Split capsule animation on authentication success!
        topHalf.position.y += 0.06;
        bottomHalf.position.y -= 0.06;
        capsuleGroup.rotation.z += 0.12;
        capsuleGroup.rotation.y += 0.12;
        camera.position.z -= 0.08;

        if (camera.position.z < 1.2) {
          // Trigger the animation complete callback
          if (onAnimationCompleteRef.current) {
            onAnimationCompleteRef.current();
          }
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    // Clean up
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      resizeObserver.disconnect();
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      if (rendererRef.current) {
        const domElement = rendererRef.current.domElement;
        if (container.contains(domElement)) {
          container.removeChild(domElement);
        }
        rendererRef.current.dispose();
      }

      // Dispose geometries & materials
      topGeom.dispose();
      topCyl.dispose();
      topMaterial.dispose();
      bottomGeom.dispose();
      bottomCyl.dispose();
      bottomMaterial.dispose();
    };
  }, [brandColor]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-[240px] my-[-10px] cursor-grab active:cursor-grabbing relative z-20 flex justify-center items-center"
      id="animation-container"
    />
  );
};
