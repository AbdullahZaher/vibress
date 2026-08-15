import { useState, useEffect, useCallback } from 'react';

export function useScrollSpy(sectionIds: string[], offset = 100) {
  const [activeSection, setActiveSection] = useState<string>(sectionIds[0] || '');

  // Scroll to section smoothly and update URL path cleanly without hash redundancy
  const scrollToSection = useCallback((id: string, updateUrl = true) => {
    const section = document.getElementById(id);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (updateUrl) {
        window.history.replaceState(null, '', `/admin/settings/${id}`);
      }
      setActiveSection(id);
    }
  }, []);

  useEffect(() => {
    // Check if browser supports IntersectionObserver for scroll spy
    const observers: IntersectionObserver[] = [];

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setActiveSection(id);
              // Update URL path to reflect visible section without triggering page reload
              if (window.location.pathname.startsWith('/admin/settings')) {
                window.history.replaceState(null, '', `/admin/settings/${id}`);
              }
            }
          });
        },
        {
          root: null, // viewport or scroll container
          rootMargin: `-${offset}px 0px -60% 0px`,
          threshold: 0,
        }
      );

      observer.observe(el);
      observers.push(observer);
    });

    return () => {
      observers.forEach((obs) => obs.disconnect());
    };
  }, [sectionIds, offset]);

  return { activeSection, scrollToSection };
}
