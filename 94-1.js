// server.js - WebSocket server for real-time speech translation with Azure Cognitive Services

// Import required modules
const http = require('http');
const WebSocket = require('ws');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Azure Speech Service configuration
const speechConfig = sdk.SpeechTranslationConfig.fromSubscription(
  process.env.SPEECH_KEY,  // Your Azure Speech Service key
  process.env.SPEECH_REGION  // Your Azure Speech Service region
);

// Configure speech recognition settings
speechConfig.speechRecognitionLanguage = "en-US";  // Source language
speechConfig.addTargetLanguage("zh-CN");  // Chinese translation

// Create HTTP server with basic routing for the HTML client
const server = http.createServer((req, res) => {
  // Simple routing
  const url = req.url;
  
  if (url === '/' || url === '/index.html') {
    // Serve the HTML client
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, content) => {
      if (err) {
        res.writeHead(500);
        res.end(`Error loading the client: ${err.message}`);
        return;
      }
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
  } else {
    // Handle 404
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 Not Found</h1>');
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Debug: Log active connections
let connections = 0;
const logStatus = () => {
  console.log(`Active connections: ${connections}`);
};

// Handle WebSocket connections
wss.on('connection', (ws) => {
  connections++;
  console.log('Client connected');
  logStatus();
  
  // Initialize variables for audio processing
  let recognizer = null;
  let pushStream = null;
  let audioConfig = null;
  let totalAudioBytes = 0;
  let audioChunksReceived = 0;
  
  // Send a welcome message to the client
  ws.send(JSON.stringify({
    type: 'info',
    message: 'Connected to Speech Translation Server'
  }));

  // Handle messages from client
  ws.on('message', (message) => {
    // Check if the message is a control message (JSON) or binary audio data
    if (typeof message === 'string' || (message instanceof Buffer && message[0] === '{'.charCodeAt(0))) {
      try {
        const control = JSON.parse(message.toString());
        
        // Handle different control messages
        if (control.type === 'start') {
          // Start a new recognition session
          startRecognition(control.sourceLanguage, control.targetLanguages);
        } else if (control.type === 'stop') {
          // Stop the current recognition session
          stopRecognition();
        }
      } catch (e) {
        console.error('Error parsing control message:', e);
      }
    } else {
      // Handle binary audio data
      if (pushStream) {
        // Process the audio data (assuming it's PCM)
        processAudioData(message);
      }
    }
  });

  // Handle WebSocket closure
  ws.on('close', () => {
    connections--;
    console.log('Client disconnected');
    logStatus();
    stopRecognition();
  });

  // Handle WebSocket errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    stopRecognition();
  });

  // Function to process audio data
  function processAudioData(audioBuffer) {
    if (!pushStream) {
      console.error('Push stream is not initialized');
      return;
    }
    
    try {
      // Convert ArrayBuffer to Buffer if needed
      const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
      
      // Check if we have valid audio data
      if (buffer.length > 0) {
        pushStream.write(buffer);
        
        // Log audio statistics
        audioChunksReceived++;
        totalAudioBytes += buffer.length;
        
        if (audioChunksReceived % 20 === 0) {
          console.log(`Audio stats: ${audioChunksReceived} chunks, ${(totalAudioBytes / 1024).toFixed(2)} KB total`);
        }
      }
    } catch (error) {
      console.error('Error processing audio data:', error);
    }
  }

  // Function to start speech recognition and translation
  function startRecognition(sourceLanguage = 'en-US', targetLanguages = ['zh-CN']) {
    // Clean up any existing recognizer
    stopRecognition();
    
    // Reset audio statistics
    totalAudioBytes = 0;
    audioChunksReceived = 0;
    
    console.log(`Starting recognition: source=${sourceLanguage}, targets=${targetLanguages.join(',')}`);
    
    // Configure speech settings
    speechConfig.speechRecognitionLanguage = sourceLanguage;
    
    // Clear target languages and add new ones
    speechConfig.targetLanguages = [];
    targetLanguages.forEach(lang => {
      speechConfig.addTargetLanguage(lang);
    });
    
    try {
      // Create push stream for audio data
      pushStream = sdk.AudioInputStream.createPushStream();
      
      // Create audio configuration from the push stream
      audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
      
      // Create a translation recognizer
      recognizer = new sdk.TranslationRecognizer(speechConfig, audioConfig);
      
      // Handle recognized speech (final results)
      recognizer.recognized = (s, e) => {
        if (e.result.reason === sdk.ResultReason.TranslatedSpeech) {
          // Get recognition result
          const original = e.result.text;
          console.log(`Recognized (FINAL): "${original}"`);
          
          // Extract translations directly from the JSON object
          let translations = {};
          
          try {
            // Parse the JSON if it exists
            if (e.result.privJson) {
              const resultJson = JSON.parse(e.result.privJson);
              console.log('resultJson');
              console.log(resultJson.Translation.Translations);
              // Check if Translation property exists and has data
              if (resultJson.Translation && resultJson.Translation.Translations) {
                resultJson.Translation.Translations.forEach(translation => {
                  // Map language codes if needed (zh-Hans -> zh-CN)
                  let langCode = translation.Language;
                  if (langCode === 'zh-Hans') langCode = 'zh-CN';
                  if (langCode === 'yue') langCode = 'zh-HK';
                  if (langCode === 'en') langCode = 'en-US';
                  if (langCode === 'ja') langCode = 'ja-JP';
                  if (langCode === 'ko') langCode = 'ko-KR';
                  
                  translations[langCode] = translation.Text;
                  console.log(`Translation (${langCode}): "${translation.Text}"`);
                });
              }
            } else {
              // Fallback to the translations collection if available
              targetLanguages.forEach(lang => {
                // Try to get the translation from the object
                const translationText = e.result.translations ? e.result.translations.get(lang) : null;
                if (translationText) {
                  translations[lang] = translationText;
                  console.log(`Translation (${lang}): "${translationText}"`);
                }
              });
            }
          } catch (error) {
            console.error('Error extracting translations:', error);
            
            // Attempt to get raw translation data for debugging
            console.log('Raw translation data:', e.result.privTranslations);
          }
          
          // Send results to client
          ws.send(JSON.stringify({
            type: 'result',
            original: original,
            translations: translations
          }));
        }
      };
      
      // Handle interim results - ENABLED
      recognizer.recognizing = (s, e) => {
        if (e.result.reason === sdk.ResultReason.TranslatingSpeech) {
          const interim = e.result.text;
          console.log(`Recognizing (INTERIM): "${interim}"`);
          
          // Extract interim translations if available
          let interimTranslations = {};
          
          try {
            // Try to get translations from the result object
            if (e.result.privJson) {
              console.log(e.result.privJson)
              const resultJson = JSON.parse(e.result.privJson);
              
              if (resultJson.Translation && resultJson.Translation.Translations) {
                resultJson.Translation.Translations.forEach(translation => {
                  let langCode = translation.Language;
                  if (langCode === 'zh-Hans') langCode = 'zh-CN';
                  if (langCode === 'yue') langCode = 'zh-HK';
                  if (langCode === 'en') langCode = 'en-US';
                  if (langCode === 'ja') langCode = 'ja-JP';
                  if (langCode === 'ko') langCode = 'ko-KR';
                  
                  interimTranslations[langCode] = translation.Text;
                });
              }
            } else if (e.result.translations) {
              targetLanguages.forEach(lang => {
                const translationText = e.result.translations.get(lang);
                if (translationText) {
                  interimTranslations[lang] = translationText;
                }
              });
            }
          } catch (error) {
            console.error('Error extracting interim translations:', error);
          }
          console.log('interimTranslations');
          console.log(interimTranslations);
          // Send interim results with translations if available
          ws.send(JSON.stringify({
            type: 'interim',
            original: interim,
            translations: interimTranslations
          }));
        }
      };
      
      // Handle errors
      recognizer.canceled = (s, e) => {
        console.log(`Recognition canceled: ${e.reason}`);
        if (e.reason === sdk.CancellationReason.Error) {
          console.error(`Error details: ${e.errorDetails} (code: ${e.errorCode})`);
          ws.send(JSON.stringify({
            type: 'error',
            message: `Error: ${e.errorCode} - ${e.errorDetails}`
          }));
        }
        stopRecognition();
      };
      
      // Handle session stopped events
      recognizer.sessionStopped = (s, e) => {
        console.log('Recognition session stopped');
        stopRecognition();
      };
      
      // Start continuous recognition
      recognizer.startContinuousRecognitionAsync(
        () => {
          console.log('Recognition started successfully');
          ws.send(JSON.stringify({
            type: 'info',
            message: 'Recognition started - speak now'
          }));
        },
        (err) => {
          console.error('Error starting recognition:', err);
          ws.send(JSON.stringify({
            type: 'error',
            message: `Failed to start recognition: ${err}`
          }));
        }
      );
    } catch (error) {
      console.error('Error setting up recognition:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: `Setup error: ${error.message}`
      }));
    }
  }

  // Function to stop speech recognition
  function stopRecognition() {
    if (recognizer) {
      try {
        recognizer.stopContinuousRecognitionAsync(
          () => {
            console.log('Recognition stopped successfully');
            ws.send(JSON.stringify({
              type: 'info',
              message: 'Recognition stopped'
            }));
          },
          (err) => {
            console.error('Error stopping recognition:', err);
          }
        );
      } catch (e) {
        console.error('Exception stopping recognition:', e);
      } finally {
        recognizer = null;
      }
    }
    
    if (pushStream) {
      try {
        pushStream.close();
      } catch (e) {
        console.error('Error closing push stream:', e);
      } finally {
        pushStream = null;
      }
    }
    
    if (audioConfig) {
      audioConfig = null;
    }
    
    // Log final audio statistics
    if (audioChunksReceived > 0) {
      console.log(`Final audio stats: ${audioChunksReceived} chunks, ${(totalAudioBytes / 1024).toFixed(2)} KB total`);
    }
  }
});

// Create directory structure if it doesn't exist
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

// Write the HTML client to the public directory
const htmlClientPath = path.join(publicDir, 'index.html');
try {
  // Read html-client.html from the current directory (where you saved the client)
  // You'll need to save the HTML client file first
  const htmlClientContent = fs.readFileSync(path.join(__dirname, 'html-client.html'), 'utf8');
  fs.writeFileSync(htmlClientPath, htmlClientContent);
  console.log('HTML client written to public/index.html');
} catch (error) {
  console.error('Error writing HTML client:', error);
  console.log('Please manually copy the HTML client to public/index.html');
}

// Start the server
const PORT = process.env.PORT || 8531;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser to use the speech translation client`);
});