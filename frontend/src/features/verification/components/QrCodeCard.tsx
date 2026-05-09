import { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

interface QrCodeCardProps {
  url: string;
  tokenName: string;
}

export const QrCodeCard = ({ url, tokenName }: QrCodeCardProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleDownload = () => {
    const canvas = wrapperRef.current?.querySelector('canvas');
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `verify-${tokenName}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="glass rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4">Share & Verify</h3>
      <div className="flex flex-col items-center">
        <div ref={wrapperRef} className="bg-white p-3 rounded-xl inline-block">
          <QRCodeCanvas
            value={url}
            size={160}
            level="M"
            includeMargin={false}
          />
        </div>
        <p className="text-xs text-gray-400 mt-2">Scan to verify on any device</p>
        <p className="font-mono text-xs text-gray-500 mt-1">{tokenName}</p>
        <button
          onClick={handleDownload}
          className="text-sm text-gray-400 hover:text-white underline mt-3 transition-colors"
        >
          Download QR Code
        </button>
      </div>
    </div>
  );
};
