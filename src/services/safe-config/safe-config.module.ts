import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { HttpErrorHandler } from '../errors/http-error-handler';
import { SafeConfigService } from './safe-config.service';

const BASE_URL_PROVIDER = {
  provide: 'SAFE_CONFIG_BASE_URL',
  useValue: 'https://safe-config.gnosis.io', // TODO extract to a config file
};

@Module({
  imports: [HttpModule],
  providers: [SafeConfigService, BASE_URL_PROVIDER, HttpErrorHandler],
  exports: [SafeConfigService, BASE_URL_PROVIDER],
})
export class SafeConfigModule {}
