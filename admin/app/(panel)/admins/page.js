import { redirect } from 'next/navigation';

// The log is what people open most
export default function AdminsPage() {
  redirect('/admins/audit-log');
}
