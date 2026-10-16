import { useEffect, useState } from 'react';
// Mobile Safari can shrink/pan the visual viewport without changing 100dvh.
export function useVisualViewport() {
  const [viewport, setViewport] = useState();
  useEffect(() => {
    const visual = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setViewport({ height: visual?.height ?? window.innerHeight, top: visual?.offsetTop ?? 0 });
      });
    };
    update();
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return viewport;
}
