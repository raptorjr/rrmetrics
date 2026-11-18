/**
 * ProjectX Gateway API client for Topstep trade sync.
 * Uses API key + username auth (not OAuth).
 * Docs: https://gateway.docs.projectx.com/docs/category/api-reference
 */

const BASE_URL = 'https://api.topstepx.com/api';

interface AuthResponse {
  token: string;
  success: boolean;
  errorCode: number;
  errorMessage: string | null;
}

interface AccountResponse {
  accounts: Array<{
    id: number;
    name: string;
    balance: number;
    canTrade: boolean;
    isVisible: boolean;
  }>;
  success: boolean;
  errorCode: number;
  errorMessage: string | null;
}

export interface Trade {
  id: number;
  accountId: number;
  contractId: string;
  creationTimestamp: string;
  price: number;
  profitAndLoss: number | null;
  fees: number | null;
  commissions: number | null;
  side: number;
  size: number;
  voided: boolean;
  orderId: number;
  fillId: number | null;
}

interface TradeResponse {
  trades: Trade[];
  success: boolean;
  errorCode: number;
  errorMessage: string | null;
}

export interface OpenPosition {
  id: number;
  accountId: number;
  contractId: string;
  creationTimestamp: string;
  type: number;
  size: number;
  averagePrice: number;
}

interface OpenPositionResponse {
  positions: OpenPosition[];
  success: boolean;
  errorCode: number;
  errorMessage: string | null;
}

interface Contract {
  id: string;
  name: string;
  description: string;
  tickSize: number;
  tickValue: number;
  activeContract: boolean;
  symbolId: string;
}

interface ContractResponse {
  contracts: Contract[];
  success: boolean;
  errorCode: number;
  errorMessage: string | null;
}

interface ContractByIdResponse {
  contract: Contract | null;
  success: boolean;
  errorCode: number;
  errorMessage: string | null;
}

export class ProjectXAPI {
  private token: string | null = null;

  /**
   * Authenticate with the ProjectX API using username + API key.
   * Returns the session token (valid for 24 hours).
   */
  async authenticate(userName: string, apiKey: string): Promise<string> {
    const response = await fetch(`${BASE_URL}/Auth/loginKey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'text/plain' },
      body: JSON.stringify({ userName, apiKey }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Auth failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as AuthResponse;
    if (!data.success || data.errorCode !== 0) {
      throw new Error(data.errorMessage || 'Authentication failed');
    }

    this.token = data.token;
    return data.token;
  }

  /**
   * Validate and refresh a session token.
   * Returns a new token if the current one is still valid.
   */
  async validateToken(token: string): Promise<string> {
    const response = await fetch(`${BASE_URL}/Auth/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept: 'text/plain',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Token validation failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      newToken: string;
      success: boolean;
      errorCode: number;
      errorMessage: string | null;
    };

    if (!data.success || data.errorCode !== 0) {
      throw new Error(data.errorMessage || 'Token validation failed');
    }

    this.token = data.newToken;
    return data.newToken;
  }

  /**
   * Fetch all active accounts for the authenticated user.
   */
  async getAccounts(token: string): Promise<AccountResponse['accounts']> {
    const response = await fetch(`${BASE_URL}/Account/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept: 'text/plain',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ onlyActiveAccounts: true }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch accounts: ${response.status}`);
    }

    const data = (await response.json()) as AccountResponse;
    if (!data.success || data.errorCode !== 0) {
      throw new Error(data.errorMessage || 'Failed to fetch accounts');
    }

    return data.accounts || [];
  }

  /**
   * Search for trades on a specific account within a time range.
   */
  async searchTrades(
    token: string,
    accountId: number,
    startTimestamp: string,
    endTimestamp?: string,
  ): Promise<Trade[]> {
    const body: Record<string, unknown> = { accountId, startTimestamp };
    if (endTimestamp) body.endTimestamp = endTimestamp;

    const response = await fetch(`${BASE_URL}/Trade/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept: 'text/plain',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch trades: ${response.status}`);
    }

    const data = (await response.json()) as TradeResponse;
    if (!data.success || data.errorCode !== 0) {
      throw new Error(data.errorMessage || 'Failed to fetch trades');
    }

    return data.trades || [];
  }

  /**
   * Fetch the broker's current open positions for an account.
   * This is used as an independent check against reconstructed trade history.
   */
  async searchOpenPositions(token: string, accountId: number): Promise<OpenPosition[]> {
    const response = await fetch(`${BASE_URL}/Position/searchOpen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept: 'text/plain',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ accountId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch open positions: ${response.status}`);
    }

    const data = (await response.json()) as OpenPositionResponse;
    if (!data.success || data.errorCode !== 0) {
      throw new Error(data.errorMessage || 'Failed to fetch open positions');
    }

    return data.positions || [];
  }

  /**
   * Search for a contract by its ID to resolve the ticker name.
   * contractId from trades looks like "CON.F.US.MNQ.Z25" — we search by the symbol portion.
   */
  async searchContract(token: string, contractId: string): Promise<Contract | null> {
    const response = await fetch(`${BASE_URL}/Contract/searchById`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept: 'text/plain',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ contractId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch contract: ${response.status}`);
    }

    const data = (await response.json()) as ContractByIdResponse;
    if (!data.success || data.errorCode !== 0) {
      return null;
    }

    return data.contract || null;
  }
}
