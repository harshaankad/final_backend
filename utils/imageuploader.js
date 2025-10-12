const cloudinary = require('cloudinary').v2;
const sharp = require('sharp');
const fs = require('fs').promises;

exports.uploadImageToCloudinary = async (file, folder, height, quality) => {
    const options = { folder };
    
    // Set default quality if not provided
    if (quality) {
        options.quality = quality;
    }
    
    options.resource_type = "auto";

    // Check file size (Cloudinary free tier limit is 10MB = 10485760 bytes)
    const MAX_FILE_SIZE = 10485760; // 10 MB
    
    if (file.size > MAX_FILE_SIZE) {
        console.log(`File ${file.name} is too large (${file.size} bytes). Compressing...`);
        
        try {
            // Create a temporary compressed file path
            const compressedPath = file.tempFilePath + '_compressed.jpg';
            
            // Compress the image using sharp
            let sharpInstance = sharp(file.tempFilePath);
            
            // Get image metadata to determine compression strategy
            const metadata = await sharpInstance.metadata();
            
            // Apply height constraint if provided
            if (height) {
                sharpInstance = sharpInstance.resize({ height: height, withoutEnlargement: true });
            }
            
            // Compress the image - start with quality 85
            let compressionQuality = 85;
            let compressedSize = file.size;
            
            // Progressive compression until file size is under limit
            while (compressedSize > MAX_FILE_SIZE && compressionQuality > 20) {
                await sharpInstance
                    .jpeg({ 
                        quality: compressionQuality, 
                        progressive: true,
                        mozjpeg: true // Better compression
                    })
                    .toFile(compressedPath);
                
                // Check the compressed file size
                const stats = await fs.stat(compressedPath);
                compressedSize = stats.size;
                
                console.log(`Compressed with quality ${compressionQuality}: ${compressedSize} bytes`);
                
                // If still too large, reduce quality
                if (compressedSize > MAX_FILE_SIZE) {
                    compressionQuality -= 10;
                    // Recreate sharp instance for next iteration
                    sharpInstance = sharp(file.tempFilePath);
                    if (height) {
                        sharpInstance = sharpInstance.resize({ height: height, withoutEnlargement: true });
                    }
                }
            }
            
            // If still too large after compression, resize dimensions
            if (compressedSize > MAX_FILE_SIZE) {
                console.log('Quality reduction not enough. Resizing dimensions...');
                
                // Calculate target dimensions (reduce by 20% each iteration)
                let targetWidth = Math.floor(metadata.width * 0.8);
                let targetHeight = Math.floor(metadata.height * 0.8);
                
                while (compressedSize > MAX_FILE_SIZE && targetWidth > 500) {
                    await sharp(file.tempFilePath)
                        .resize(targetWidth, targetHeight, {
                            fit: 'inside',
                            withoutEnlargement: true
                        })
                        .jpeg({ 
                            quality: 80, 
                            progressive: true,
                            mozjpeg: true 
                        })
                        .toFile(compressedPath);
                    
                    const stats = await fs.stat(compressedPath);
                    compressedSize = stats.size;
                    
                    console.log(`Resized to ${targetWidth}x${targetHeight}: ${compressedSize} bytes`);
                    
                    if (compressedSize > MAX_FILE_SIZE) {
                        targetWidth = Math.floor(targetWidth * 0.8);
                        targetHeight = Math.floor(targetHeight * 0.8);
                    }
                }
            }
            
            // Upload the compressed file
            const result = await cloudinary.uploader.upload(compressedPath, options);
            
            // Clean up temporary compressed file
            await fs.unlink(compressedPath).catch(err => console.log('Cleanup error:', err));
            
            console.log(`Successfully uploaded compressed file: ${result.secure_url}`);
            return result;
            
        } catch (error) {
            console.error('Error compressing image:', error);
            throw new Error(`Failed to compress and upload image: ${error.message}`);
        }
    } else {
        // File is within size limit, upload directly
        if (height) {
            options.height = height;
        }
        return await cloudinary.uploader.upload(file.tempFilePath, options);
    }
};