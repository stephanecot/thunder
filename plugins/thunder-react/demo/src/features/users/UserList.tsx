import { useUsers } from './useUsers';
import { Button } from '../../components/Button';

export function UserList() {
  const { users, loading } = useUsers();
  if (loading) {
    return <p>Loading…</p>;
  }
  return (
    <ul>
      {users.map((u) => (
        <li key={u.id}>{u.name} <Button label="View" /></li>
      ))}
    </ul>
  );
}
