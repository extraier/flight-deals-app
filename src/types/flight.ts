export interface CheapDate {
  day: number;
  month: number;
  year: number;
  duration?: number; // 行程天數
  price?: number;
}

export interface FlightDeal {
  route: string;
  destination: {
    name: string;
    code: string;
    region: string;
  };
  price: number;
  currency: string;
  badge?: {
    carryOn?: boolean;
    duration?: number;
    cheapDays?: number;
  };
  typicalPrice?: number;
  cheapestDates: CheapDate[];
  moreMonths?: number;
  totalDestinations?: number;
}
