// Re-export storage helpers under the old firestore.ts name
// so existing imports don't need to change
export {
  fetchAll,
  fetchOne,
  addDocument,
  updateDocument,
  deleteDocument,
  logAudit,
} from "./storage";
