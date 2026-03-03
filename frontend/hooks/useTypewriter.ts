import { useState, useEffect } from 'react';

export const useTypewriter = (outputText: string, speed: number = 8) => {
    const [displayedText, setDisplayedText] = useState<string>('');

    useEffect(() => {
        if (displayedText === outputText) return;

        // Reset if outputText is cleared or shorter (e.g. new generation started)
        if (outputText.length < displayedText.length) {
            setDisplayedText(outputText);
            return;
        }

        const timer = setTimeout(() => {
            const remaining = outputText.length - displayedText.length;
            // Adaptive speed: faster when far behind so content feels fluid
            // > 2000 chars behind: jump 200 chars/frame (catch-up mode)
            // > 500 chars behind:  jump 50 chars/frame  (fast mode)
            // > 100 chars behind:  jump 15 chars/frame  (medium mode)
            // otherwise:           smooth 5 chars/frame (smooth mode)
            const chunk = remaining > 2000 ? 200 : remaining > 500 ? 50 : remaining > 100 ? 15 : 5;
            setDisplayedText(outputText.slice(0, displayedText.length + chunk));
        }, speed);

        return () => clearTimeout(timer);
    }, [outputText, displayedText, speed]);

    return displayedText;
};
