import React from 'react';
import { useTranslation } from '../../i18n/useTranslation';

interface HeaderProps {
    isProcessing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
    isProcessing,
}) => {
    const { t } = useTranslation();

    return (
        <header className="bg-white border-b shadow-sm sticky top-0 z-30">
            <div className="w-full px-4 sm:px-6 h-12 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h1 className="text-base font-bold text-slate-800 leading-tight">{t('app.title')}</h1>
                </div>
                <div className="flex items-center">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border flex items-center gap-1.5 ${isProcessing ? 'bg-blue-100 text-blue-700 border-blue-200 animate-pulse' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-blue-600' : 'bg-slate-400'}`}></div>
                        {isProcessing ? t('app.status.running') : t('app.status.standby')}
                    </span>
                </div>
            </div>
        </header>
    );
};
