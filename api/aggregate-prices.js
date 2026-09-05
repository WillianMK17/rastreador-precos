import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { aggregateReceiptItems, aggregateReceiptItemsByCity } from './lib/aggregatePrices.js';

const BATCH_LIMIT = 400; // Firestore batch write limit is 500

function getAdminDb() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('firebase_admin_not_configured');
  }

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });

  return getFirestore(app);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let db;
  try {
    db = getAdminDb();
  } catch {
    return res.status(500).json({ error: 'firebase_admin_not_configured' });
  }

  let snapshot;
  try {
    snapshot = await db.collectionGroup('receipts').get();
  } catch (err) {
    console.error('Erro ao ler cupons de todos os usuários:', err);
    return res.status(502).json({ error: 'firestore_unavailable' });
  }

  const receipts = snapshot.docs.map(doc => {
    const parentUser = doc.ref.parent.parent;
    return Object.assign({}, doc.data(), { userId: parentUser ? parentUser.id : null });
  });

  // Dois níveis: resumo geral (todas as cidades) e resumo por cidade —
  // cada um com seu próprio mínimo de usuários distintos, pra nunca misturar
  // preço de uma cidade com o de outra na comparação.
  const aggregated = aggregateReceiptItems(receipts)
    .concat(aggregateReceiptItemsByCity(receipts));

  try {
    for (let i = 0; i < aggregated.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      aggregated.slice(i, i + BATCH_LIMIT).forEach(entry => {
        const { docId, ...data } = entry;
        const ref = db.collection('priceIndex').doc(docId);
        batch.set(ref, Object.assign({}, data, {
          updatedAt: FieldValue.serverTimestamp()
        }));
      });
      await batch.commit();
    }
  } catch (err) {
    console.error('Erro ao gravar priceIndex:', err);
    return res.status(502).json({ error: 'firestore_write_failed' });
  }

  return res.status(200).json({ ok: true, productsUpdated: aggregated.length });
}
