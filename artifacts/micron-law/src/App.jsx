import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Workspace from '@/pages/workspace';
import Login from '@/pages/login';
import Register from '@/pages/register';
import ResetPassword from '@/pages/reset-password';
import AdminLogin from '@/pages/admin-login';
import Admin from '@/pages/admin';
import { useTheme } from '@/components/theme';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});
function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Workspace} />
        <Route path="/cases/:caseId" component={Workspace} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/admin" component={Admin} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}
function RoutedErrorBoundary({ children }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function ThemeInit() {
  useTheme();
  return null;
}
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeInit />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
export default App;
