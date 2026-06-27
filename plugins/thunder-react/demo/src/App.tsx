import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { UserList } from './features/users/UserList';
import { UserDetail } from './features/users/UserDetail';
import { Cart } from './features/cart/Cart';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/users" element={<UserList />} />
        <Route path="/users/:id" element={<UserDetail />} />
        <Route path="/cart" element={<Cart />} />
      </Routes>
    </BrowserRouter>
  );
}
