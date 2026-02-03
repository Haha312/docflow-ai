export interface ImageMap {
    [placeholder: string]: string;
}

export const extractImagesAsPlaceholders = (html: string): { textOnly: string; imageMap: ImageMap } => {
    const imageMap: ImageMap = {};
    const imgRegex = /<img\s+[^>]*src=["'][^"']*["'][^>]*>/gi;
    let index = 0;

    const textOnly = html.replace(imgRegex, (match) => {
        const placeholder = `__IMG_${index}__`;
        imageMap[placeholder] = match;
        index++;
        return placeholder;
    });

    return { textOnly, imageMap };
};

export const restoreImages = (text: string, imageMap: ImageMap): string => {
    let result = text;
    for (const [placeholder, imgTag] of Object.entries(imageMap)) {
        result = result.split(placeholder).join(imgTag);
    }
    return result;
};
