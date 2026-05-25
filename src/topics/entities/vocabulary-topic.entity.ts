import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Topic } from '@/topics/entities/topic.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Index('IDX_vocabulary_topics_topic_id', ['topicId'])
@Entity('vocabulary_topics')
export class VocabularyTopic {
  @PrimaryColumn({ name: 'vocabulary_id', type: 'uuid' })
  vocabularyId!: string;

  @PrimaryColumn({ name: 'topic_id', type: 'uuid' })
  topicId!: string;

  @ManyToOne(() => Vocabulary, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'vocabulary_id' })
  vocabulary!: Vocabulary;

  @ManyToOne(() => Topic, (topic) => topic.vocabularyTopics, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'topic_id' })
  topic!: Topic;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
