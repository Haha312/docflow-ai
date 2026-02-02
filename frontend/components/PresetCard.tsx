import React from 'react';
import { DocPreset, PresetConfig } from '../types';

interface Props {
  config: PresetConfig;
  isSelected: boolean;
  onSelect: (id: DocPreset) => void;
}

export const PresetCard: React.FC<Props> = ({ config, isSelected, onSelect }) => {
  return (
    <button
      onClick={() => onSelect(config.id)}
      className={`relative group flex flex-col items-start p-4 rounded-2xl border transition-all duration-300 w-full text-left outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500/30
        ${isSelected
          ? `border-${config.color}-500 bg-white shadow-lg shadow-${config.color}-500/10`
          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-md hover:translate-x-1'
        }
      `}
    >
      <div className="flex items-start justify-between w-full mb-3">
        <div className={`
          p-2.5 rounded-xl text-white shadow-sm transition-transform duration-300 group-hover:scale-110
          ${isSelected ? `bg-${config.color}-500` : `bg-${config.color}-400/90 group-hover:bg-${config.color}-500`}
        `}>
          <span dangerouslySetInnerHTML={{ __html: config.icon }} />
        </div>

        {isSelected && (
          <div className={`text-${config.color}-500 animate-in fade-in zoom-in duration-200`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
          </div>
        )}
      </div>

      <h3 className={`font-bold text-base mb-1.5 ${isSelected ? 'text-zinc-900' : 'text-zinc-700'}`}>
        {config.title}
      </h3>

      <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">
        {config.description}
      </p>
    </button>
  );
};