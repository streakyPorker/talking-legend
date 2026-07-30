import { useState, useCallback, useEffect } from 'react';

interface UseResizableOptions {
  initial: number;
  min: number;
  max: number;
}

export function useResizable({ initial, min, max }: UseResizableOptions) {
  const [width, setWidth] = useState(initial);
  const [dragging, setDragging] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      // 从右边缘计算宽度（viewport - 鼠标位置）
      const w = window.innerWidth - e.clientX;
      setWidth(Math.min(max, Math.max(min, w)));
    };

    const onMouseUp = () => setDragging(false);

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, min, max]);

  return { width, dragging, onMouseDown };
}
