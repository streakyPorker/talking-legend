import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ConfigService,
  GetConfigResponse,
  PutConfigResponse,
} from './config.service';

/**
 * 配置中心 HTTP 入口 — 纯编排层。
 *
 * schema 元数据、TOML 读写、校验逻辑已全部下沉到 ConfigService
 * （CONFIG_SCHEMA 是唯一配置键声明源），controller 只做请求转发。
 */
@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getConfig(): GetConfigResponse {
    return this.configService.getConfigData();
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  updateConfig(@Body() body: { changes: Record<string, string | number> }): PutConfigResponse {
    return this.configService.applyChanges(body?.changes);
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  resetConfig(): { success: boolean; message: string } {
    return this.configService.resetToDefault();
  }
}
