import { useParams } from 'react-router-dom';
import { useUsers } from './useUsers';

export function UserDetail() {
  const { id } = useParams();
  const { users } = useUsers();
  const user = users.find((u) => u.id === id);
  return <section>{user?.name ?? 'Unknown'}</section>;
}
