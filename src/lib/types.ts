export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  organization?: string;
  phone?: string;            // mobile number — used to verify self-service password reset
  projects?: string[];
  allowedLocations?: string[];
}

// The primary/owner account — protected from deletion.
export const PRIMARY_ACCOUNT_EMAIL = "arunpethaperumal@gmail.com";

export interface CustomRole {
  id: string;
  name: string;
  allowedTabs: string[];
  description?: string;
  createdAt: string;
}

export interface KitItem {
  description: string;
  qty: number;
}

export interface Asset {
  id: string;
  name: string;
  uuid: string;
  status: "Available" | "Dispatched" | "In-Transit" | "Maintenance" | "Retired" | "Under Repair" | "Damaged" | "Lost";
  location: string;
  healthScore: number;
  lastUpdated: string;
  rfidTag?: string;
  bleTag?: string;
  customerId?: string;
  projectId?: string;
  cost?: number;          // Unit cost / declared value (baseline, for DC & sales reporting)
  description?: string;   // Asset category / short description for DC grouping
  kitItems?: KitItem[];   // Kit components bundled with this asset
  cycleCount?: number;    // Number of completed return trips to master warehouse
  retireCategory?: "Damaged" | "End of Life" | "Lost" | "Other";
  retireReason?: string;
  retiredAt?: string;
  conditionNotes?: string;
  conditionUpdatedAt?: string;
}

/** One full round-trip: Master WH → field locations → Master WH */
export interface AssetCycle {
  id: string;
  assetId: string;
  assetName: string;
  cycleNumber: number;
  startedAt: string;         // Checkout from master WH
  completedAt?: string;      // Check-in back at master WH
  durationDays?: number;
  locationsVisited: string[];// Ordered list of locations visited
  status: "Active" | "Completed";
}

// Customers and locations are merged: each customer IS a location.
// Non-warehouse locations carry the customer's contact details.
// name = organization name; name/address/gst are printed on Delivery Challans.
export interface Location {
  id: string;
  name: string;                  // Location / Organization name (shown on DC)
  type?: "Rustoppers Warehouse" | "Customer Site";
  status: "Active" | "Inactive";
  address?: string;              // Full address (shown on DC)
  gst?: string;                  // GST number (shown on DC)
  isMasterWarehouse?: boolean;   // Assets can only be initially registered here
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  status: "Active" | "Closed";
  startDate?: string;
  endDate?: string;
  // Flow configuration — the movement loop for this project:
  //   primaryLocation → stage 1 → stage 2 → … → back to primary
  // Each stage may offer several alternative locations (1.a, 1.b, 1.c…);
  // when a stage has more than one, the user picks which at check-out.
  primaryLocation?: string;
  receivingStages?: string[][];  // preferred: one array of alternatives per stage
  receivingLocations?: string[]; // legacy: exactly one location per stage
  // Loop rate card: the price of one full route through the flow. When a stage
  // branches (1.a/1.b/…), each branch choice is a distinct, separately-priced
  // loop. Keyed by the branch choices joined with "|" (or "__single__" when
  // the flow has no branch). Used as the declared value on the Delivery Challan.
  loopCosts?: Record<string, number>;
  slaDays?: number;              // SLA (days) for this project's customer
  // Contract type
  contractType?: "po" | "agreement";   // default = "po" for backward compat
  // PO-based fields
  poNumber?: string;
  poQty?: number;
  poEndDate?: string;
  minQtyAlert?: number;
  poFileUrl?: string;
  poFileName?: string;
  // PO movement counting config
  poCountFromLocation?: string;  // only count movements FROM this location
  poCountToLocation?: string;    // only count movements TO this location
  poBasis?: "asset" | "pack";    // "asset" = 1 movement = 1 unit; "pack" = N assets = 1 invoiced unit
  packQty?: number;              // assets per pack (only when poBasis = "pack")
  poPrice?: number;              // price per invoiced unit (asset or pack)
  // Agreement-based fields
  agreementStartDate?: string;
  agreementEndDate?: string;
  agreementFileUrl?: string;
  agreementFileName?: string;
  allowedLocations?: string[];  // Location names assets may move to within this project
  // Sustainability config (kg of material saved per asset per cycle)
  woodPerAsset?: number;
  corrugationPerAsset?: number;
}

export interface AssetMovement {
  id: string;
  assetId: string;
  assetName: string;
  fromLocation: string;
  toLocation: string;
  movementType: "Checkout" | "Checkin" | "Transfer";
  status: "In-Transit" | "Completed";
  createdBy: string;
  createdAt: string;
  completedBy?: string;
  completedAt?: string;
  notes?: string;
  rfidTag?: string;
  bleTag?: string;
  cycleId?: string;          // Reference to the AssetCycle this movement belongs to
  forceCompleted?: boolean;  // True when warehouse staff force-inwarded a skipped check-in
}

export interface Order {
  id: string;
  assetId: string;
  carrier: string;
  status: "Pending" | "Approved" | "Dispatched" | "Received";
  origin: string;
  destination: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface Transfer {
  id: string;
  type: "Outbound Dispatch" | "Inbound Return" | "Inter-plant Transfer" | "Project Transfer" | "Site-to-Site Transfer";
  assetIds: string[];
  fromLocation: string;
  toLocation: string;
  carrier?: string;
  status: "Pending" | "Approved" | "Completed";
  notes?: string;
  dcGenerated?: boolean;
  createdBy: string;
  createdAt: string;
}

export interface PickupRequest {
  id: string;
  requestedBy: string;
  location: string;
  assetIds: string[];
  status: "Open" | "Scheduled" | "Completed";
  createdAt: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userEmail: string;
  action: string;
  category: "Asset" | "Order" | "User" | "Role" | "Pickup" | "Transfer" | "Report" | "Project";
  details: string;
}

export interface DCCancellation {
  id: string;
  movementId: string;
  assetIds: string[];
  assetNames: string;
  fromLocation: string;
  toLocation: string;
  requestedBy: string;
  requestedAt: string;
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "error" | "success";
  read: boolean;
  createdAt: string;
  forUser?: string;   // uid of the target user; absent = global (shown to everyone)
}

export interface ScheduledReport {
  id: string;
  name: string;
  type: "Daily Summary" | "Weekly Asset Movement" | "KPI Report" | "Audit Report" | "Location Inventory";
  frequency: "Daily" | "Weekly" | "Monthly";
  recipients: string[];
  enabled: boolean;
  lastSent?: string;
  createdAt: string;
  projectId?: string;       // Scope report to a specific project
  notifyOnOrder?: boolean;  // Email when a new Order is created
  notifyOnPickup?: boolean; // Email when a new Pickup Request is created
}

export interface DCLog {
  id: string;
  dcNo: string;
  createdAt: string;        // ISO timestamp
  fromLocation: string;
  toLocation: string;
  movementType: string;
  description: string;      // first asset name / summary
  qty: number;
  lineMode: "individual" | "cumulative";
  showRFID: boolean;
  showBLE: boolean;
  createdBy?: string;       // uid of the user who generated the DC
  /** Snapshots stored so we can re-generate the PDF later */
  assetSnapshots: Array<{
    id: string; name: string; uuid: string;
    rfidTag?: string; bleTag?: string; cost?: number; description?: string;
  }>;
}

export const BUILT_IN_ROLES = ["Admin", "Manager", "Employee", "Customer"];

export interface Enquiry {
  id: string;
  name: string;
  email: string;
  company?: string;
  phone?: string;
  productInterest?: string;
  message: string;
  status: "New" | "Contacted" | "Closed";
  createdAt: string;
}

export interface GalleryImage {
  id: string;
  url: string;
  name: string;
  category?: string;
  caption?: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Expense {
  id: string;
  projectId: string;
  category: "Purchase" | "Maintenance" | "Transport" | "Labour" | "Rent" | "Other";
  description: string;
  amount: number;
  date: string;
  createdBy: string;
  createdAt: string;
}

export const ALL_TABS = [
  { id: "dashboard",     label: "Dashboard" },
  { id: "assets",        label: "Inventory" },
  { id: "scanner",       label: "Asset Scanner" },
  { id: "movements",     label: "Asset Movement" },
  { id: "transfers",     label: "Transfers" },
  { id: "cycles",        label: "Cycle Report" },
  { id: "orders",        label: "Orders" },
  { id: "pickups",       label: "Pickup Requests" },
  { id: "projects",      label: "Projects" },
  { id: "gallery",       label: "Product Gallery" },
  { id: "sustainability", label: "Sustainability" },
  { id: "locations",     label: "Locations" },
  { id: "hardware",      label: "Hardware Config" },
  { id: "forecasting",   label: "AI Forecasting" },
  { id: "inventory",     label: "Inventory Charts" },
  { id: "reports",       label: "Reports & KPI" },
  { id: "pl",            label: "P&L Analysis" },
  { id: "notifications", label: "Notifications" },
  { id: "audit",         label: "Audit Logs" },
  { id: "admin",         label: "Administration" },
];
