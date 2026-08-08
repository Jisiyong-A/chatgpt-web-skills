/**
 * Conceptual UI contract (spec §9).
 * Describes FUNCTION ("an editable composer in the lower region of the main
 * area") rather than exact DOM structure. If the ARIA structure changes but
 * functional relationships remain valid, the adapter continues normally.
 */

export const CAPABILITIES = [
  'composer',
  'submit_control',
  'latest_user_message',
  'latest_assistant_message',
  'generation_status',
  'new_chat',
  'retry_control',
  'model_indicator',
  'conversation_region',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface ConversationPageContract {
  required: {
    main_region: boolean;
    editable_composer: boolean;
  };
}

export const CONVERSATION_PAGE_CONTRACT: ConversationPageContract = {
  required: {
    main_region: true,
    editable_composer: true,
  },
};

export const COMPOSER_CONTRACT = {
  editable: true,
  visible: true,
  location: 'lower_region',
} as const;

export const RESPONSE_CONTRACT = {
  relation: {
    after_latest_user_message: true,
  },
} as const;
