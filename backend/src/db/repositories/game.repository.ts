import { Injectable, Inject } from '@nestjs/common';
import { DB_INSTANCE } from '../db.module';

@Injectable()
export class GameRepository {
  constructor(@Inject(DB_INSTANCE) private readonly db: Map<string, Map<string, unknown>>) {
    // CRUD operations on the 'game' table will be implemented in RFC-002
  }
}
