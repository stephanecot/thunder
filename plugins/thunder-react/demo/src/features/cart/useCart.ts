import { useState, useCallback } from 'react';

export function useCart() {
  const [items, setItems] = useState<string[]>([]);
  const add = useCallback((sku: string) => {
    if (!sku) {
      throw new Error('sku is required');
    }
    setItems((prev) => [...prev, sku]);
  }, []);
  return { items, add };
}
