import { useCart } from './useCart';

export const Cart = () => {
  const { items, add } = useCart();
  return (
    <div>
      <span>{items.length} items</span>
      <button onClick={() => add('demo')}>Add</button>
    </div>
  );
};
