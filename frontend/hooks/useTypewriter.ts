import { useState, useEffect } from 'react';

export const useTypewriter = (outputText: string, speed: number = 10) => {
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
            // Adaptive speed: faster if behind
            // If very far behind (>1000 chars), add 50 chars per frame
            // If moderately behind (>200 chars), add 10 chars per frame
            // Otherwise, smooth typing (3 chars per frame)
            const chunk = remaining > 1000 ? 50 : remaining > 200 ? 10 : 3;

            setDisplayedText(outputText.slice(0, displayedText.length + chunk));
        }, speed);

        return () => clearTimeout(timer);
    }, [outputText, displayedText, speed]);

    return displayedText;
};
