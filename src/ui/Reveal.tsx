import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';

/** Provided by a screen's scroll view: scrolls so that `node` sits near the top. */
export const ScrollToContext = createContext<((node: View | null, offset?: number) => void) | null>(null);

/** For a screen's ScrollView: `<ScrollView ref={scrollRef}><View ref={contentRef} collapsable={false}>…` */
export function useScrollTo() {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const scrollToNode = useCallback((node: View | null, offset = 12) => {
    const content = contentRef.current;
    if (!node || !content) return;
    node.measureLayout(
      content,
      (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - offset), animated: true }),
      () => {},
    );
  }, []);
  return { scrollRef, contentRef, scrollToNode };
}

/**
 * Wraps a section that opens (a drop-down list, a row's details): the moment `active`
 * turns on, the screen scrolls to it, so nobody has to scroll down to find it.
 */
export function Reveal({ active, children, style }: { active: boolean; children: ReactNode; style?: ViewStyle }) {
  const scrollTo = useContext(ScrollToContext);
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!active || !scrollTo) return;
    const t = setTimeout(() => scrollTo(ref.current), 80);
    return () => clearTimeout(t);
  }, [active, scrollTo]);
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}
