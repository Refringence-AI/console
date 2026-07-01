import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { TooltipProvider } from './components/ui/tooltip';
// Self-hosted fonts (offline-first): bundled by Vite, no Google Fonts CDN.
// These register the "Geist Variable" / "Geist Mono Variable" @font-face;
// the globals.css font stack lists them first.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/globals.css';
import { router } from './router';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Tight stale times on lists, generous on metadata. Overridden
            // per-query by individual hooks under src/lib/queries/.
            staleTime: 60_000,
            gcTime: 60 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});

const root = createRoot(document.getElementById('root')!);
root.render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={300}>
                <RouterProvider router={router} />
                <Toaster
                    position="bottom-right"
                    richColors
                    closeButton
                    theme="system"
                    toastOptions={{
                        classNames: {
                            toast: 'border border-border bg-popover text-popover-foreground',
                        },
                    }}
                />
            </TooltipProvider>
        </QueryClientProvider>
    </StrictMode>,
);
