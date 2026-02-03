import React from 'react';
import { PresetConfig } from '../types';

interface PresetCardProps {
  config: PresetConfig;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export const PresetCard: React.FC<PresetCardProps> = ({ config, isSelected, onSelect }) => {
  return (
    <div
      onClick={() => onSelect(config.id)}
      className={`relative p-3.5 rounded-xl cursor-pointer transition-all duration-200 border group select-none flex items-center gap-3
        ${isSelected
          ? 'bg-emerald-50 border-emerald-500 shadow-sm'
          : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
        }
      `}
    >
      {/* Selection Checkmark */}
      {isSelected && (
        <div className="absolute top-0 right-0 p-[1px] bg-emerald-500 rounded-bl-lg rounded-tr-lg">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
      )}

      <div
        className={`p-2.5 rounded-lg transition-all duration-200 flex-shrink-0 flex items-center justify-center [&>svg]:w-[18px] [&>svg]:h-[18px] [&>svg]:stroke-[1.5] ${isSelected
          ? 'bg-emerald-500 text-white'
          : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200 group-hover:text-gray-700'
          }`}
        dangerouslySetInnerHTML={{ __html: config.icon }}
      />

      <div className="min-w-0">
        <h3 className={`font-medium text-sm truncate ${isSelected ? 'text-emerald-900 font-semibold' : 'text-gray-700'}`}>
          {config.title}
        </h3>
      </div>
    </div>
  );
}