import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { UserIdentity } from '@/users/entities/user-identity.entity';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  passwordHash!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  username!: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 512, nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role!: UserRole;

  @Column({ name: 'is_email_verified', type: 'boolean', default: false })
  isEmailVerified!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'is_onboarded', type: 'boolean', default: false })
  isOnboarded!: boolean;

  @Column({
    name: 'native_language',
    type: 'varchar',
    length: 8,
    nullable: true,
  })
  nativeLanguage!: string | null;

  @Column({
    name: 'target_language',
    type: 'varchar',
    length: 8,
    nullable: true,
  })
  targetLanguage!: string | null;

  @Column({
    name: 'proficiency_level',
    type: 'enum',
    enum: ProficiencyLevel,
    enumName: 'proficiency_level_enum',
    nullable: true,
  })
  proficiencyLevel!: ProficiencyLevel | null;

  @Column({
    name: 'daily_goal_minutes',
    type: 'smallint',
    nullable: true,
  })
  dailyGoalMinutes!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => UserIdentity, (identity) => identity.user)
  identities!: UserIdentity[];
}
