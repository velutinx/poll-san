// services/triviaImage.js
const sharp = require('sharp');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { putR2Image } = require('./r2Storage'); // we'll create this

const RAINBOW_OVERLAY_URL = 'https://www.velutinx.com/images/rainbow_foreground.jpg';
const SECTIONS = 12; // 3 columns × 4 rows

/**
 * Download an image from a URL
 */
async function downloadImage(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
}

/**
 * Create a trivia image with a specified number of visible sections
 * @param {Buffer} originalImage - The original character image buffer
 * @param {number} sectionsVisible - Number of sections to reveal (1-12)
 * @param {Buffer} overlayImage - The rainbow overlay image buffer
 * @returns {Promise<Buffer>} - The composite image buffer
 */
async function createTriviaImage(originalImage, sectionsVisible, overlayImage) {
    // Get metadata
    const metadata = await sharp(originalImage).metadata();
    const { width, height } = metadata;

    // Calculate section dimensions (3 columns × 4 rows)
    const sectionWidth = Math.floor(width / 3);
    const sectionHeight = Math.floor(height / 4);

    // Resize overlay to match original image
    const overlayResized = await sharp(overlayImage)
        .resize(width, height, { fit: 'fill' })
        .toBuffer();

    // Start with the original image
    let composite = await sharp(originalImage).toBuffer();

    // For each section, decide if it should be visible or covered
    // We'll build a composite by layering the overlay with cutouts
    // Approach: create a mask and composite

    // Create a transparent image the size of the original
    const maskBuffer = await sharp({
        create: {
            width: width,
            height: height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    }).png().toBuffer();

    // For each section, if it should be visible, make that area transparent in the mask
    // Otherwise, the overlay will cover it
    // We'll use the overlay as a base, then composite the original image where sections are visible

    // Simpler approach: Create a canvas-like composite using sharp's composite
    const layers = [];

    // Always add the original image as the base layer
    layers.push({ input: originalImage, blend: 'over' });

    // For each section, if it should be hidden, we need to cover it with the overlay
    // But we want the overlay to cover only the hidden sections
    // Better: overlay the entire image, then cut out the visible sections

    // Create the overlay layer
    const overlayBuffer = await sharp(overlayResized).toBuffer();

    // For visible sections, we need to "cut out" the overlay
    // We'll use a mask: black overlay, white cutouts for visible sections
    // This is complex with sharp's API, so we'll use a different approach:

    // 1. Start with the original image
    // 2. For each hidden section, composite the overlay on top

    let result = originalImage;
    const overlayBufferFull = overlayResized;

    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
            const sectionIndex = row * 3 + col;
            const isVisible = sectionIndex < sectionsVisible;

            if (!isVisible) {
                // Extract the section from the overlay
                const overlaySection = await sharp(overlayBufferFull)
                    .extract({
                        left: col * sectionWidth,
                        top: row * sectionHeight,
                        width: sectionWidth,
                        height: sectionHeight
                    })
                    .toBuffer();

                // Composite the overlay section onto the result at the correct position
                result = await sharp(result)
                    .composite([{
                        input: overlaySection,
                        left: col * sectionWidth,
                        top: row * sectionHeight,
                        blend: 'over'
                    }])
                    .jpeg({ quality: 85 })
                    .toBuffer();
            }
        }
    }

    return result;
}

/**
 * Generate a unique key for the trivia image in R2
 */
function getTriviaImageKey(gameId, version) {
    return `images/trivia/${gameId}/trivia_${version}.jpg`;
}

/**
 * Process and upload a trivia image
 */
async function processAndUploadTriviaImage(originalImageBuffer, gameId, sectionsVisible = 1) {
    // Download the rainbow overlay
    const overlayBuffer = await downloadImage(RAINBOW_OVERLAY_URL);

    // Create the composite image
    const compositeImage = await createTriviaImage(originalImageBuffer, sectionsVisible, overlayBuffer);

    // Upload to R2
    const key = getTriviaImageKey(gameId, sectionsVisible);
    const result = await putR2Image(key, compositeImage, 'image/jpeg');

    return {
        key,
        url: result.url, // or generate from your R2 domain
        sectionsVisible
    };
}

/**
 * Update a trivia image with a new number of visible sections
 */
async function updateTriviaImage(gameId, sectionsVisible) {
    // Fetch the original image from R2
    // This would require storing the original image key somewhere
    // We'll store it in the games_trivia table as original_image_key
    // For now, assume we have it
    // TODO: Implement this
}

module.exports = {
    createTriviaImage,
    processAndUploadTriviaImage,
    updateTriviaImage,
    getTriviaImageKey,
    SECTIONS
};
