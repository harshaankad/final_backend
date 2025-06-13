const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// Function to edit an image (Adding text & annotations)
const editImage = async (imageUrl, text, outputFilename) => {
    const localPath = path.join(__dirname, `../uploads/${outputFilename}`);
    
    try {
        // Download the image from Cloudinary
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        
        // Process the image
        await sharp(Buffer.from(buffer))
            .resize(500) // Resize if needed
            .composite([{ 
                input: Buffer.from(
                    `<svg width="500" height="500">
                        <text x="50" y="50" font-size="30" fill="red">${text}</text>
                    </svg>`
                ), 
                gravity: "northwest"
            }])
            .toFormat("png")
            .toFile(localPath);

        return localPath; // Return local file path
    } catch (error) {
        console.error("Error processing image:", error);
        throw error;
    }
};

module.exports = editImage;
