export interface Transaction {
  district: string;
  name: string;
  date: string;
  dateObj: Date | null;
  price: string;
  total: string;
  area: string;
  roomType: string;
  floor: string;
  caseObject: string;
}

export interface RoomStat {
  count: number;
  areas: number[];
  prices: number[];
  totals: number[];
}

export interface FormattedRoomStat {
  count: number;
  areaRange: string;
  totalRange: string;
  unitPriceRange: string;
}

export interface GroupedData {
  district: string;
  name: string;
  address: string;
  transactions: number;
  totalPriceSum: number;
  unitPrices: number[];
  totalPrices: number[];
  areas: number[];
  dates: string[];
  dateObjects: Date[];
  roomStats: Record<string, RoomStat>;
  parking: {
    count: number;
    prices: number[];
    avg?: string;
    range?: string;
  };
  special: {
    count: number;
    desc?: string;
  };
  // Computed fields
  priceRange: string;
  avgPriceNum: number;
  totalAmount: string;
  rawTotalAmount: number;
  areaRange: string;
  totalPriceRange: string;
  roomTypes: Record<string, FormattedRoomStat>;
  dateRange: string;
  lastDate: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface DataStats {
  totalRaw: number;
  presale: number;
  filtered: number;
}

export interface ProcessedData {
  grouped: GroupedData[];
  latest: Transaction[];
}
