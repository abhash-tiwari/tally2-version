const use = require('@tensorflow-models/universal-sentence-encoder');
require('@tensorflow/tfjs'); // tfjs for JS backend (no native bindings)

let modelPromise = null;

async function getModel() {
  if (!modelPromise) {
    modelPromise = use.load();
  }
  return modelPromise;
}

async function getEmbedding(text) {
  const model = await getModel();
  const embeddings = await model.embed([text]);
  const embeddingArray = embeddings.arraySync()[0];
  embeddings.dispose();
  return embeddingArray;
}

module.exports = { getEmbedding };
