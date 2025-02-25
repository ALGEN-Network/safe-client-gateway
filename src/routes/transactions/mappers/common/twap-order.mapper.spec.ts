import { fakeJson } from '@/__tests__/faker';
import { FakeConfigurationService } from '@/config/__tests__/fake.configuration.service';
import { IConfigurationService } from '@/config/configuration.service.interface';
import { IChainsRepository } from '@/domain/chains/chains.repository.interface';
import { MultiSendDecoder } from '@/domain/contracts/decoders/multi-send-decoder.helper';
import { ComposableCowDecoder } from '@/domain/swaps/contracts/decoders/composable-cow-decoder.helper';
import { GPv2Decoder } from '@/domain/swaps/contracts/decoders/gp-v2-decoder.helper';
import { Order } from '@/domain/swaps/entities/order.entity';
import { ISwapsRepository } from '@/domain/swaps/swaps.repository';
import { tokenBuilder } from '@/domain/tokens/__tests__/token.builder';
import { ITokenRepository } from '@/domain/tokens/token.repository.interface';
import { GPv2OrderHelper } from '@/routes/transactions/helpers/gp-v2-order.helper';
import { SwapOrderHelper } from '@/routes/transactions/helpers/swap-order.helper';
import { TwapOrderHelper } from '@/routes/transactions/helpers/twap-order.helper';
import { TwapOrderMapper } from '@/routes/transactions/mappers/common/twap-order.mapper';
import { ILoggingService } from '@/logging/logging.interface';
import { getAddress } from 'viem';
import { fullAppDataBuilder } from '@/domain/swaps/entities/__tests__/full-app-data.builder';
import { TransactionDataFinder } from '@/routes/transactions/helpers/transaction-data-finder.helper';
import { SwapAppsHelper } from '@/routes/transactions/helpers/swap-apps.helper';

const loggingService = {
  debug: jest.fn(),
  warn: jest.fn(),
} as jest.MockedObjectDeep<ILoggingService>;
const mockLoggingService = jest.mocked(loggingService);

const mockTokenRepository = {
  getToken: jest.fn(),
} as jest.MockedObjectDeep<ITokenRepository>;

const mockSwapsRepository = {
  getOrder: jest.fn(),
  getFullAppData: jest.fn(),
} as jest.MockedObjectDeep<ISwapsRepository>;

const mockConfigurationService = {
  getOrThrow: jest.fn(),
} as jest.MockedObjectDeep<IConfigurationService>;

const mockChainsRepository = {
  getChain: jest.fn(),
} as jest.MockedObjectDeep<IChainsRepository>;

describe('TwapOrderMapper', () => {
  const configurationService = new FakeConfigurationService();
  const multiSendDecoder = new MultiSendDecoder();
  const transactionDataFinder = new TransactionDataFinder(multiSendDecoder);
  const gpv2Decoder = new GPv2Decoder(mockLoggingService);
  const allowedApps = new Set<string>();
  const swapOrderHelper = new SwapOrderHelper(
    transactionDataFinder,
    gpv2Decoder,
    mockTokenRepository,
    mockSwapsRepository,
    mockConfigurationService,
    mockChainsRepository,
  );
  const composableCowDecoder = new ComposableCowDecoder();
  const gpv2OrderHelper = new GPv2OrderHelper();
  configurationService.set('swaps.restrictApps', false);
  const twapOrderHelper = new TwapOrderHelper(
    transactionDataFinder,
    composableCowDecoder,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should map a queued TWAP order', async () => {
    const now = new Date();
    jest.setSystemTime(now);

    configurationService.set('swaps.maxNumberOfParts', 2);

    // We instantiate in tests to be able to set maxNumberOfParts
    const mapper = new TwapOrderMapper(
      configurationService,
      mockLoggingService,
      swapOrderHelper,
      mockSwapsRepository,
      composableCowDecoder,
      gpv2OrderHelper,
      twapOrderHelper,
      new SwapAppsHelper(configurationService, allowedApps),
    );

    // Taken from queued transaction of specified owner before execution
    const chainId = '11155111';
    const owner = '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381';
    const data =
      '0x0d0d9800000000000000000000000000000000000000000000000000000000000000008000000000000000000000000052ed56da04309aca4c3fecc595298d80c2f16bac000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000010000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a50000000000000000000000000000000000000000000000000000001903c57a7700000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b140000000000000000000000000625afb445c3b6b7b929342a04a22599fd5dbb5900000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000006f05b59d3b2000000000000000000000000000000000000000000000000000165e249251c2365980000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000023280000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000';

    const buyToken = tokenBuilder()
      .with('address', '0x0625aFB445C3B6B7B929342a04A22599fd5dBB59')
      .build();
    const sellToken = tokenBuilder()
      .with('address', '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14')
      .build();
    const fullAppData = JSON.parse(fakeJson());

    // Orders throw as they don't exist
    mockSwapsRepository.getOrder.mockRejectedValue(
      new Error('Order not found'),
    );
    mockTokenRepository.getToken.mockImplementation(async ({ address }) => {
      // We only need mock part1 addresses as all parts use the same tokens
      switch (address) {
        case buyToken.address: {
          return Promise.resolve(buyToken);
        }
        case sellToken.address: {
          return Promise.resolve(sellToken);
        }
        default: {
          return Promise.reject(new Error(`Token not found: ${address}`));
        }
      }
    });
    mockSwapsRepository.getFullAppData.mockResolvedValue({ fullAppData });

    const result = await mapper.mapTwapOrder(chainId, owner, {
      data,
      executionDate: null,
    });

    expect(result).toEqual({
      buyAmount: '51576509680023161648',
      buyToken: {
        address: buyToken.address,
        decimals: buyToken.decimals,
        logoUri: buyToken.logoUri,
        name: buyToken.name,
        symbol: buyToken.symbol,
        trusted: buyToken.trusted,
      },
      class: 'limit',
      durationOfPart: {
        durationType: 'AUTO',
      },
      executedBuyAmount: '0',
      executedSellAmount: '0',
      executedSurplusFee: '0',
      fullAppData,
      humanDescription: null,
      kind: 'sell',
      minPartLimit: '25788254840011580824',
      numberOfParts: '2',
      status: 'presignaturePending',
      owner: '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381',
      partSellAmount: '500000000000000000',
      receiver: '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381',
      richDecodedInfo: null,
      sellAmount: '1000000000000000000',
      sellToken: {
        address: sellToken.address,
        decimals: sellToken.decimals,
        logoUri: sellToken.logoUri,
        name: sellToken.name,
        symbol: sellToken.symbol,
        trusted: sellToken.trusted,
      },
      startTime: {
        startType: 'AT_MINING_TIME',
      },
      timeBetweenParts: 9000,
      type: 'TwapOrder',
      validUntil: Math.ceil(now.getTime() / 1_000) + 17999,
    });
  });

  it('should map an executed TWAP order', async () => {
    configurationService.set('swaps.maxNumberOfParts', 2);

    // We instantiate in tests to be able to set maxNumberOfParts
    const mapper = new TwapOrderMapper(
      configurationService,
      mockLoggingService,
      swapOrderHelper,
      mockSwapsRepository,
      composableCowDecoder,
      gpv2OrderHelper,
      twapOrderHelper,
      new SwapAppsHelper(configurationService, allowedApps),
    );

    /**
     * @see https://sepolia.etherscan.io/address/0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74
     */
    const chainId = '11155111';
    const owner = '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381';
    const data =
      '0x0d0d9800000000000000000000000000000000000000000000000000000000000000008000000000000000000000000052ed56da04309aca4c3fecc595298d80c2f16bac000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000010000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a500000000000000000000000000000000000000000000000000000019011f294a00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000007080000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000';
    const executionDate = new Date(1718288040000);

    /**
     * @see https://explorer.cow.fi/sepolia/orders/0xdaabe82f86545c66074b5565962e96758979ae80124aabef05e0585149d30f7931eac7f0141837b266de30f4dc9af15629bd5381666b05af?tab=overview
     */
    const part1 = {
      creationDate: '2024-06-13T14:14:02.269522Z',
      owner: '0x31eac7f0141837b266de30f4dc9af15629bd5381',
      uid: '0xdaabe82f86545c66074b5565962e96758979ae80124aabef05e0585149d30f7931eac7f0141837b266de30f4dc9af15629bd5381666b05af',
      availableBalance: null,
      executedBuyAmount: '691671781640850856',
      executedSellAmount: '213586875483862141750',
      executedSellAmountBeforeFees: '213586875483862141750',
      executedFeeAmount: '0',
      executedSurplusFee: '111111111',
      invalidated: false,
      status: 'fulfilled',
      class: 'limit',
      settlementContract: '0x9008d19f58aabd9ed0d60971565aa8510560ab41',
      fullFeeAmount: '0',
      solverFee: '0',
      isLiquidityOrder: false,
      fullAppData:
        '{"appCode":"Safe Wallet Swaps","metadata":{"orderClass":{"orderClass":"twap"},"quote":{"slippageBips":1000},"widget":{"appCode":"CoW Swap-SafeApp","environment":"production"}},"version":"1.1.0"}',
      sellToken: '0xbe72e441bf55620febc26715db68d3494213d8cb',
      buyToken: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      receiver: '0x31eac7f0141837b266de30f4dc9af15629bd5381',
      sellAmount: '213586875483862141750',
      buyAmount: '611289510998251134',
      validTo: 1718289839,
      appData:
        '0xf7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda0',
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      signingScheme: 'eip1271',
      signature:
        '0x5fd7e97ddaee378bd0eb30ddf479272accf91761e697bc00e067a268f95f1d2732ed230bd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000002200000000000000000000000000000000000000000000000000000000000000180000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e00000000000000000000000000000000000000000000000000000000666b05aff7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000f3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee34677500000000000000000000000000000000000000000000000000000000000000005a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc95a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc90000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a500000000000000000000000000000000000000000000000000000019011f294a00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000007080000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000',
      interactions: { pre: [], post: [] },
    } as unknown as Order;
    /**
     * @see https://explorer.cow.fi/sepolia/orders/0x557cb31a9dbbd23830c57d9fd3bbfc3694e942c161232b6cf696ba3bd11f9d6631eac7f0141837b266de30f4dc9af15629bd5381666b0cb7?tab=overview
     */
    const part2 = {
      creationDate: '2024-06-13T14:44:02.307987Z',
      owner: '0x31eac7f0141837b266de30f4dc9af15629bd5381',
      uid: '0x557cb31a9dbbd23830c57d9fd3bbfc3694e942c161232b6cf696ba3bd11f9d6631eac7f0141837b266de30f4dc9af15629bd5381666b0cb7',
      availableBalance: null,
      executedBuyAmount: '687772850053823756',
      executedSellAmount: '213586875483862141750',
      executedSellAmountBeforeFees: '213586875483862141750',
      executedFeeAmount: '0',
      executedSurplusFee: '111111111',
      invalidated: false,
      status: 'fulfilled',
      class: 'limit',
      settlementContract: '0x9008d19f58aabd9ed0d60971565aa8510560ab41',
      fullFeeAmount: '0',
      solverFee: '0',
      isLiquidityOrder: false,
      fullAppData:
        '{"appCode":"Safe Wallet Swaps","metadata":{"orderClass":{"orderClass":"twap"},"quote":{"slippageBips":1000},"widget":{"appCode":"CoW Swap-SafeApp","environment":"production"}},"version":"1.1.0"}',
      sellToken: '0xbe72e441bf55620febc26715db68d3494213d8cb',
      buyToken: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      receiver: '0x31eac7f0141837b266de30f4dc9af15629bd5381',
      sellAmount: '213586875483862141750',
      buyAmount: '611289510998251134',
      validTo: 1718291639,
      appData:
        '0xf7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda0',
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      signingScheme: 'eip1271',
      signature:
        '0x5fd7e97ddaee378bd0eb30ddf479272accf91761e697bc00e067a268f95f1d2732ed230bd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000002200000000000000000000000000000000000000000000000000000000000000180000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e00000000000000000000000000000000000000000000000000000000666b0cb7f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000f3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee34677500000000000000000000000000000000000000000000000000000000000000005a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc95a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc90000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a500000000000000000000000000000000000000000000000000000019011f294a00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000007080000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000',
      interactions: { pre: [], post: [] },
    } as unknown as Order;

    const buyToken = tokenBuilder()
      .with('address', getAddress(part1.buyToken))
      .build();
    const sellToken = tokenBuilder()
      .with('address', getAddress(part1.sellToken))
      .build();
    const fullAppData = JSON.parse(fakeJson());

    mockSwapsRepository.getOrder
      .mockResolvedValueOnce(part1)
      .mockResolvedValueOnce(part2);
    mockTokenRepository.getToken.mockImplementation(async ({ address }) => {
      // We only need mock part1 addresses as all parts use the same tokens
      switch (address) {
        case buyToken.address: {
          return Promise.resolve(buyToken);
        }
        case sellToken.address: {
          return Promise.resolve(sellToken);
        }
        default: {
          return Promise.reject(new Error(`Token not found: ${address}`));
        }
      }
    });
    mockSwapsRepository.getFullAppData.mockResolvedValue({ fullAppData });

    const result = await mapper.mapTwapOrder(chainId, owner, {
      data,
      executionDate,
    });

    expect(result).toEqual({
      buyAmount: '1222579021996502268',
      buyToken: {
        address: buyToken.address,
        decimals: buyToken.decimals,
        logoUri: buyToken.logoUri,
        name: buyToken.name,
        symbol: buyToken.symbol,
        trusted: buyToken.trusted,
      },
      class: 'limit',
      durationOfPart: {
        durationType: 'AUTO',
      },
      executedBuyAmount: '1379444631694674612',
      executedSellAmount: '427173750967724283500',
      executedSurplusFee: '222222222',
      fullAppData,
      humanDescription: null,
      kind: 'sell',
      minPartLimit: '611289510998251134',
      numberOfParts: '2',
      status: 'fulfilled',
      owner: '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381',
      partSellAmount: '213586875483862141750',
      receiver: '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381',
      richDecodedInfo: null,
      sellAmount: '427173750967724283500',
      sellToken: {
        address: sellToken.address,
        decimals: sellToken.decimals,
        logoUri: sellToken.logoUri,
        name: sellToken.name,
        symbol: sellToken.symbol,
        trusted: sellToken.trusted,
      },
      startTime: {
        startType: 'AT_MINING_TIME',
      },
      timeBetweenParts: 1800,
      type: 'TwapOrder',
      validUntil: 1718291639,
    });
  });

  it('should map a TWAP order, up to a limit', async () => {
    configurationService.set('swaps.maxNumberOfParts', 1);

    // We instantiate in tests to be able to set maxNumberOfParts
    const mapper = new TwapOrderMapper(
      configurationService,
      mockLoggingService,
      swapOrderHelper,
      mockSwapsRepository,
      composableCowDecoder,
      gpv2OrderHelper,
      twapOrderHelper,
      new SwapAppsHelper(configurationService, allowedApps),
    );

    /**
     * @see https://sepolia.etherscan.io/address/0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74
     */
    const chainId = '11155111';
    const owner = '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381';
    const data =
      '0x0d0d9800000000000000000000000000000000000000000000000000000000000000008000000000000000000000000052ed56da04309aca4c3fecc595298d80c2f16bac000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000010000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a500000000000000000000000000000000000000000000000000000019011f294a00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000007080000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000';
    const executionDate = new Date(1718288040000);

    const part2 = {
      creationDate: '2024-06-13T14:44:02.307987Z',
      owner: '0x31eac7f0141837b266de30f4dc9af15629bd5381',
      uid: '0x557cb31a9dbbd23830c57d9fd3bbfc3694e942c161232b6cf696ba3bd11f9d6631eac7f0141837b266de30f4dc9af15629bd5381666b0cb7',
      availableBalance: null,
      executedBuyAmount: '687772850053823756',
      executedSellAmount: '213586875483862141750',
      executedSellAmountBeforeFees: '213586875483862141750',
      executedFeeAmount: '0',
      executedSurplusFee: '2135868754838621123',
      invalidated: false,
      status: 'fulfilled',
      class: 'limit',
      settlementContract: '0x9008d19f58aabd9ed0d60971565aa8510560ab41',
      fullFeeAmount: '0',
      solverFee: '0',
      isLiquidityOrder: false,
      fullAppData:
        '{"appCode":"Safe Wallet Swaps","metadata":{"orderClass":{"orderClass":"twap"},"quote":{"slippageBips":1000},"widget":{"appCode":"CoW Swap-SafeApp","environment":"production"}},"version":"1.1.0"}',
      sellToken: '0xbe72e441bf55620febc26715db68d3494213d8cb',
      buyToken: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      receiver: '0x31eac7f0141837b266de30f4dc9af15629bd5381',
      sellAmount: '213586875483862141750',
      buyAmount: '611289510998251134',
      validTo: 1718291639,
      appData:
        '0xf7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda0',
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      signingScheme: 'eip1271',
      signature:
        '0x5fd7e97ddaee378bd0eb30ddf479272accf91761e697bc00e067a268f95f1d2732ed230bd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000002200000000000000000000000000000000000000000000000000000000000000180000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e00000000000000000000000000000000000000000000000000000000666b0cb7f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000f3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee34677500000000000000000000000000000000000000000000000000000000000000005a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc95a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc90000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a500000000000000000000000000000000000000000000000000000019011f294a00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000007080000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000',
      interactions: { pre: [], post: [] },
    } as unknown as Order;

    const buyToken = tokenBuilder()
      .with('address', getAddress(part2.buyToken))
      .build();
    const sellToken = tokenBuilder()
      .with('address', getAddress(part2.sellToken))
      .build();
    const fullAppData = JSON.parse(fakeJson());

    mockSwapsRepository.getOrder.mockResolvedValueOnce(part2);
    mockTokenRepository.getToken.mockImplementation(async ({ address }) => {
      // We only need mock part1 addresses as all parts use the same tokens
      switch (address) {
        case buyToken.address: {
          return Promise.resolve(buyToken);
        }
        case sellToken.address: {
          return Promise.resolve(sellToken);
        }
        default: {
          return Promise.reject(new Error(`Token not found: ${address}`));
        }
      }
    });
    mockSwapsRepository.getFullAppData.mockResolvedValue({ fullAppData });

    const result = await mapper.mapTwapOrder(chainId, owner, {
      data,
      executionDate,
    });

    expect(result).toEqual({
      buyAmount: '1222579021996502268',
      buyToken: {
        address: buyToken.address,
        decimals: buyToken.decimals,
        logoUri: buyToken.logoUri,
        name: buyToken.name,
        symbol: buyToken.symbol,
        trusted: buyToken.trusted,
      },
      class: 'limit',
      durationOfPart: {
        durationType: 'AUTO',
      },
      executedBuyAmount: null,
      executedSellAmount: null,
      executedSurplusFee: null,
      fullAppData,
      humanDescription: null,
      kind: 'sell',
      minPartLimit: '611289510998251134',
      numberOfParts: '2',
      status: 'fulfilled',
      owner: '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381',
      partSellAmount: '213586875483862141750',
      receiver: '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381',
      richDecodedInfo: null,
      sellAmount: '427173750967724283500',
      sellToken: {
        address: sellToken.address,
        decimals: sellToken.decimals,
        logoUri: sellToken.logoUri,
        name: sellToken.name,
        symbol: sellToken.symbol,
        trusted: sellToken.trusted,
      },
      startTime: {
        startType: 'AT_MINING_TIME',
      },
      timeBetweenParts: 1800,
      type: 'TwapOrder',
      validUntil: 1718291639,
    });
  });

  it('should throw an error if source apps are restricted and no fullAppData is available', async () => {
    const now = new Date();
    jest.setSystemTime(now);

    configurationService.set('swaps.maxNumberOfParts', 2);
    configurationService.set('swaps.restrictApps', true);

    // We instantiate in tests to be able to set maxNumberOfParts
    const mapper = new TwapOrderMapper(
      configurationService,
      loggingService,
      swapOrderHelper,
      mockSwapsRepository,
      composableCowDecoder,
      gpv2OrderHelper,
      new TwapOrderHelper(transactionDataFinder, composableCowDecoder),
      new SwapAppsHelper(configurationService, allowedApps),
    );

    // Taken from queued transaction of specified owner before execution
    const chainId = '11155111';
    const owner = '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381';
    const data =
      '0x0d0d9800000000000000000000000000000000000000000000000000000000000000008000000000000000000000000052ed56da04309aca4c3fecc595298d80c2f16bac000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000010000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a50000000000000000000000000000000000000000000000000000001903c57a7700000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b140000000000000000000000000625afb445c3b6b7b929342a04a22599fd5dbb5900000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000006f05b59d3b2000000000000000000000000000000000000000000000000000165e249251c2365980000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000023280000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000';

    const { fullAppData } = fullAppDataBuilder()
      .with('fullAppData', null)
      .build();

    // Orders throw as they don't exist
    mockSwapsRepository.getOrder.mockRejectedValue(
      new Error('Order not found'),
    );
    mockSwapsRepository.getFullAppData.mockResolvedValue({ fullAppData });

    await expect(
      mapper.mapTwapOrder(chainId, owner, {
        data,
        executionDate: null,
      }),
    ).rejects.toThrow(`Unsupported App: undefined`);
  });

  it('should throw an error if source apps are restricted and fullAppData does not match any allowed app', async () => {
    const now = new Date();
    jest.setSystemTime(now);

    configurationService.set('swaps.maxNumberOfParts', 2);
    configurationService.set('swaps.restrictApps', true);

    // We instantiate in tests to be able to set maxNumberOfParts
    const mapper = new TwapOrderMapper(
      configurationService,
      loggingService,
      swapOrderHelper,
      mockSwapsRepository,
      composableCowDecoder,
      gpv2OrderHelper,
      new TwapOrderHelper(transactionDataFinder, composableCowDecoder),
      new SwapAppsHelper(configurationService, new Set(['app1', 'app2'])),
    );

    // Taken from queued transaction of specified owner before execution
    const chainId = '11155111';
    const owner = '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381';
    const data =
      '0x0d0d9800000000000000000000000000000000000000000000000000000000000000008000000000000000000000000052ed56da04309aca4c3fecc595298d80c2f16bac000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000010000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a50000000000000000000000000000000000000000000000000000001903c57a7700000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b140000000000000000000000000625afb445c3b6b7b929342a04a22599fd5dbb5900000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000006f05b59d3b2000000000000000000000000000000000000000000000000000165e249251c2365980000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000023280000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000';

    const { fullAppData } = fullAppDataBuilder()
      .with('fullAppData', { appCode: 'app3' })
      .build();

    // Orders throw as they don't exist
    mockSwapsRepository.getOrder.mockRejectedValue(
      new Error('Order not found'),
    );
    mockSwapsRepository.getFullAppData.mockResolvedValue({ fullAppData });

    await expect(
      mapper.mapTwapOrder(chainId, owner, {
        data,
        executionDate: null,
      }),
    ).rejects.toThrow(`Unsupported App: ${fullAppData.appCode}`);
  });

  it('should throw an error if source apps are restricted and a part order fullAppData does not match any allowed app', async () => {
    configurationService.set('swaps.maxNumberOfParts', 2);
    configurationService.set('swaps.restrictApps', true);

    // We instantiate in tests to be able to set maxNumberOfParts
    const mapper = new TwapOrderMapper(
      configurationService,
      mockLoggingService,
      swapOrderHelper,
      mockSwapsRepository,
      composableCowDecoder,
      gpv2OrderHelper,
      new TwapOrderHelper(transactionDataFinder, composableCowDecoder),
      new SwapAppsHelper(configurationService, allowedApps),
    );

    /**
     * @see https://sepolia.etherscan.io/address/0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74
     */
    const chainId = '11155111';
    const owner = '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381';
    const data =
      '0x0d0d9800000000000000000000000000000000000000000000000000000000000000008000000000000000000000000052ed56da04309aca4c3fecc595298d80c2f16bac000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000010000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a500000000000000000000000000000000000000000000000000000019011f294a00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000007080000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000';
    const executionDate = new Date(1718288040000);
    /**
     * @see https://explorer.cow.fi/sepolia/orders/0xdaabe82f86545c66074b5565962e96758979ae80124aabef05e0585149d30f7931eac7f0141837b266de30f4dc9af15629bd5381666b05af?tab=overview
     */
    const part1 = {
      creationDate: '2024-06-13T14:14:02.269522Z',
      owner: '0x31eac7f0141837b266de30f4dc9af15629bd5381',
      uid: '0xdaabe82f86545c66074b5565962e96758979ae80124aabef05e0585149d30f7931eac7f0141837b266de30f4dc9af15629bd5381666b05af',
      availableBalance: null,
      executedBuyAmount: '691671781640850856',
      executedSellAmount: '213586875483862141750',
      executedSellAmountBeforeFees: '213586875483862141750',
      executedFeeAmount: '0',
      executedSurplusFee: '111111111',
      invalidated: false,
      status: 'fulfilled',
      class: 'limit',
      settlementContract: '0x9008d19f58aabd9ed0d60971565aa8510560ab41',
      fullFeeAmount: '0',
      solverFee: '0',
      isLiquidityOrder: false,
      fullAppData: JSON.parse(
        '{"appCode":"Safe Wallet Swaps","metadata":{"orderClass":{"orderClass":"twap"},"quote":{"slippageBips":1000},"widget":{"appCode":"CoW Swap-SafeApp","environment":"production"}},"version":"1.1.0"}',
      ),
      sellToken: '0xbe72e441bf55620febc26715db68d3494213d8cb',
      buyToken: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      receiver: '0x31eac7f0141837b266de30f4dc9af15629bd5381',
      sellAmount: '213586875483862141750',
      buyAmount: '611289510998251134',
      validTo: 1718289839,
      appData:
        '0xf7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda0',
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      signingScheme: 'eip1271',
      signature:
        '0x5fd7e97ddaee378bd0eb30ddf479272accf91761e697bc00e067a268f95f1d2732ed230bd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000002200000000000000000000000000000000000000000000000000000000000000180000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e00000000000000000000000000000000000000000000000000000000666b05aff7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000f3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee34677500000000000000000000000000000000000000000000000000000000000000005a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc95a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc90000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a500000000000000000000000000000000000000000000000000000019011f294a00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000007080000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000',
      interactions: { pre: [], post: [] },
    } as unknown as Order;

    const buyToken = tokenBuilder()
      .with('address', getAddress(part1.buyToken))
      .build();
    const sellToken = tokenBuilder()
      .with('address', getAddress(part1.sellToken))
      .build();
    const fullAppData = JSON.parse(fakeJson());

    mockSwapsRepository.getOrder.mockResolvedValueOnce(part1);
    mockTokenRepository.getToken.mockImplementation(async ({ address }) => {
      // We only need mock part1 addresses as all parts use the same tokens
      switch (address) {
        case buyToken.address: {
          return Promise.resolve(buyToken);
        }
        case sellToken.address: {
          return Promise.resolve(sellToken);
        }
        default: {
          return Promise.reject(new Error(`Token not found: ${address}`));
        }
      }
    });
    mockSwapsRepository.getFullAppData.mockResolvedValue({ fullAppData });

    await expect(
      mapper.mapTwapOrder(chainId, owner, {
        data,
        executionDate,
      }),
    ).rejects.toThrow(`Unsupported App: ${fullAppData.appCode}`);
  });

  it('should map the TWAP order if source apps are restricted and a part order fullAppData matches any of the allowed apps', async () => {
    configurationService.set('swaps.restrictApps', true);

    // We instantiate in tests to be able to set maxNumberOfParts
    const mapper = new TwapOrderMapper(
      configurationService,
      mockLoggingService,
      swapOrderHelper,
      mockSwapsRepository,
      composableCowDecoder,
      gpv2OrderHelper,
      new TwapOrderHelper(transactionDataFinder, composableCowDecoder),
      new SwapAppsHelper(configurationService, new Set(['Safe Wallet Swaps'])),
    );

    /**
     * @see https://sepolia.etherscan.io/address/0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74
     */
    const chainId = '11155111';
    const owner = '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381';
    const data =
      '0x0d0d9800000000000000000000000000000000000000000000000000000000000000008000000000000000000000000052ed56da04309aca4c3fecc595298d80c2f16bac000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000010000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a500000000000000000000000000000000000000000000000000000019011f294a00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000007080000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000';
    const executionDate = new Date(1718288040000);

    /**
     * @see https://explorer.cow.fi/sepolia/orders/0xdaabe82f86545c66074b5565962e96758979ae80124aabef05e0585149d30f7931eac7f0141837b266de30f4dc9af15629bd5381666b05af?tab=overview
     */
    const part1 = {
      creationDate: '2024-06-13T14:14:02.269522Z',
      owner: '0x31eac7f0141837b266de30f4dc9af15629bd5381',
      uid: '0xdaabe82f86545c66074b5565962e96758979ae80124aabef05e0585149d30f7931eac7f0141837b266de30f4dc9af15629bd5381666b05af',
      availableBalance: null,
      executedBuyAmount: '691671781640850856',
      executedSellAmount: '213586875483862141750',
      executedSellAmountBeforeFees: '213586875483862141750',
      executedFeeAmount: '0',
      executedSurplusFee: '111111111',
      invalidated: false,
      status: 'fulfilled',
      class: 'limit',
      settlementContract: '0x9008d19f58aabd9ed0d60971565aa8510560ab41',
      fullFeeAmount: '0',
      solverFee: '0',
      isLiquidityOrder: false,
      fullAppData: JSON.parse(
        '{"appCode":"Safe Wallet Swaps","metadata":{"orderClass":{"orderClass":"twap"},"quote":{"slippageBips":1000},"widget":{"appCode":"CoW Swap-SafeApp","environment":"production"}},"version":"1.1.0"}',
      ),
      sellToken: '0xbe72e441bf55620febc26715db68d3494213d8cb',
      buyToken: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      receiver: '0x31eac7f0141837b266de30f4dc9af15629bd5381',
      sellAmount: '213586875483862141750',
      buyAmount: '611289510998251134',
      validTo: 1718289839,
      appData:
        '0xf7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda0',
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      signingScheme: 'eip1271',
      signature:
        '0x5fd7e97ddaee378bd0eb30ddf479272accf91761e697bc00e067a268f95f1d2732ed230bd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000002200000000000000000000000000000000000000000000000000000000000000180000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e00000000000000000000000000000000000000000000000000000000666b05aff7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000f3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee34677500000000000000000000000000000000000000000000000000000000000000005a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc95a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc90000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a500000000000000000000000000000000000000000000000000000019011f294a00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000be72e441bf55620febc26715db68d3494213d8cb000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000b941d039eed310b36000000000000000000000000000000000000000000000000087bbc924df9167e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000007080000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000',
      interactions: { pre: [], post: [] },
    } as unknown as Order;

    const buyToken = tokenBuilder()
      .with('address', getAddress(part1.buyToken))
      .build();
    const sellToken = tokenBuilder()
      .with('address', getAddress(part1.sellToken))
      .build();
    const { fullAppData } = fullAppDataBuilder()
      .with('fullAppData', { appCode: 'Safe Wallet Swaps' })
      .build();

    mockSwapsRepository.getOrder.mockResolvedValueOnce(part1);
    mockTokenRepository.getToken.mockImplementation(async ({ address }) => {
      // We only need mock part1 addresses as all parts use the same tokens
      switch (address) {
        case buyToken.address: {
          return Promise.resolve(buyToken);
        }
        case sellToken.address: {
          return Promise.resolve(sellToken);
        }
        default: {
          return Promise.reject(new Error(`Token not found: ${address}`));
        }
      }
    });
    mockSwapsRepository.getFullAppData.mockResolvedValue({ fullAppData });

    const actual = await mapper.mapTwapOrder(chainId, owner, {
      data,
      executionDate,
    });

    expect(actual).toBeDefined();
  });

  it('should map a queued TWAP order if source apps are restricted and fullAppData matches any allowed app', async () => {
    const now = new Date();
    jest.setSystemTime(now);

    configurationService.set('swaps.maxNumberOfParts', 2);
    configurationService.set('swaps.restrictApps', true);

    // We instantiate in tests to be able to set maxNumberOfParts
    const mapper = new TwapOrderMapper(
      configurationService,
      loggingService,
      swapOrderHelper,
      mockSwapsRepository,
      composableCowDecoder,
      gpv2OrderHelper,
      new TwapOrderHelper(transactionDataFinder, composableCowDecoder),
      new SwapAppsHelper(configurationService, new Set(['app1', 'app2'])),
    );

    // Taken from queued transaction of specified owner before execution
    const chainId = '11155111';
    const owner = '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381';
    const data =
      '0x0d0d9800000000000000000000000000000000000000000000000000000000000000008000000000000000000000000052ed56da04309aca4c3fecc595298d80c2f16bac000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000010000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a50000000000000000000000000000000000000000000000000000001903c57a7700000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b140000000000000000000000000625afb445c3b6b7b929342a04a22599fd5dbb5900000000000000000000000031eac7f0141837b266de30f4dc9af15629bd538100000000000000000000000000000000000000000000000006f05b59d3b2000000000000000000000000000000000000000000000000000165e249251c2365980000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000023280000000000000000000000000000000000000000000000000000000000000000f7be7261f56698c258bf75f888d68a00c85b22fb21958b9009c719eb88aebda00000000000000000000000000000000000000000000000000000000000000000';

    const buyToken = tokenBuilder()
      .with('address', '0x0625aFB445C3B6B7B929342a04A22599fd5dBB59')
      .build();
    const sellToken = tokenBuilder()
      .with('address', '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14')
      .build();
    const { fullAppData } = fullAppDataBuilder()
      .with('fullAppData', { appCode: 'app2' })
      .build();

    // Orders throw as they don't exist
    mockSwapsRepository.getOrder.mockRejectedValue(
      new Error('Order not found'),
    );
    mockTokenRepository.getToken.mockImplementation(async ({ address }) => {
      // We only need mock part1 addresses as all parts use the same tokens
      switch (address) {
        case buyToken.address: {
          return Promise.resolve(buyToken);
        }
        case sellToken.address: {
          return Promise.resolve(sellToken);
        }
        default: {
          return Promise.reject(new Error(`Token not found: ${address}`));
        }
      }
    });
    mockSwapsRepository.getFullAppData.mockResolvedValue({ fullAppData });

    const result = await mapper.mapTwapOrder(chainId, owner, {
      data,
      executionDate: null,
    });

    expect(result).toEqual({
      buyAmount: '51576509680023161648',
      buyToken: {
        address: buyToken.address,
        decimals: buyToken.decimals,
        logoUri: buyToken.logoUri,
        name: buyToken.name,
        symbol: buyToken.symbol,
        trusted: buyToken.trusted,
      },
      class: 'limit',
      durationOfPart: {
        durationType: 'AUTO',
      },
      executedBuyAmount: '0',
      executedSellAmount: '0',
      executedSurplusFee: '0',
      fullAppData,
      humanDescription: null,
      kind: 'sell',
      minPartLimit: '25788254840011580824',
      numberOfParts: '2',
      status: 'presignaturePending',
      owner: '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381',
      partSellAmount: '500000000000000000',
      receiver: '0x31eaC7F0141837B266De30f4dc9aF15629Bd5381',
      richDecodedInfo: null,
      sellAmount: '1000000000000000000',
      sellToken: {
        address: sellToken.address,
        decimals: sellToken.decimals,
        logoUri: sellToken.logoUri,
        name: sellToken.name,
        symbol: sellToken.symbol,
        trusted: sellToken.trusted,
      },
      startTime: {
        startType: 'AT_MINING_TIME',
      },
      timeBetweenParts: 9000,
      type: 'TwapOrder',
      validUntil: Math.ceil(now.getTime() / 1_000) + 17999,
    });
  });
});
