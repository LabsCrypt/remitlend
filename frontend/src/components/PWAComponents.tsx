import { useState, useEffect } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Smartphone, Download, X } from 'lucide-react';

interface PWAInstallPromptProps {
  onClose?: () => void;
}

export function PWAInstallPrompt({ onClose }: PWAInstallPromptProps) {
  const { isInstallable, install } = usePWAInstall();
  const [isInstalling, setIsInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!isInstallable || dismissed) {
    return null;
  }

  const handleInstall = async () => {
    setIsInstalling(true);
    const success = await install();
    setIsInstalling(false);
    
    if (success) {
      onClose?.();
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    onClose?.();
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96">
      <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
              <Smartphone className="w-6 h-6 text-white" />
            </div>
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm">
              Install RemitLend
            </h3>
            <p className="text-xs text-gray-600 mt-1">
              Get instant access and offline support by installing our app on your device.
            </p>
            
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleInstall}
                disabled={isInstalling}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download className="w-3 h-3" />
                {isInstalling ? 'Installing...' : 'Install'}
              </button>
              
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 transition-colors"
              >
                Not now
              </button>
            </div>
          </div>
          
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface PWAStatusIndicatorProps {
  className?: string;
}

export function PWAStatusIndicator({ className }: PWAStatusIndicatorProps) {
  const { isStandalone, isInstalled } = usePWAInstall();
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isStandalone && !isInstalled) {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs ${className}`}>
      <div className={`w-2 h-2 rounded-full ${
        isOnline ? 'bg-green-500' : 'bg-red-500'
      }`} />
      <span className="text-gray-600">
        {isOnline ? 'Online' : 'Offline'}
      </span>
      {isStandalone && (
        <span className="text-green-600 font-medium">
          • Installed
        </span>
      )}
    </div>
  );
}
