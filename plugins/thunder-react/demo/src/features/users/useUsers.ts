import { useState, useEffect } from 'react';

export interface User {
  id: string;
  name: string;
}

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => {
        setUsers(data);
        setLoading(false);
      });
  }, []);

  return { users, loading };
}
