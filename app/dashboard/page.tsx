import Dashboard from "@/components/fluxor/dashboard";
import { ProtectedRoute } from "@/lib/protected-route";

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  );
}
