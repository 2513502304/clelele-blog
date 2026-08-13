import { animation } from '@constants/design-tokens';
import {
  FloatingFocusManager,
  FloatingPortal,
  type Placement,
  useClick,
  useDismiss,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { useControlledState } from '@hooks/useControlledState';
import { useFloatingUI } from '@hooks/useFloatingUI';
import { cn } from '@lib/utils';
import { AnimatePresence, type MotionProps, motion } from 'motion/react';
import React, { cloneElement } from 'react';

type PopoverProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  render: (data: { close: () => void }) => React.ReactNode;
  placement?: Placement;
  children: React.JSX.Element;
  className?: string;
  offset?: number;
  motionProps?: MotionProps;
  trigger?: 'click' | 'hover';
  /** 可滚动表单应关闭该行为，避免内部滚动或重新定位被误判为离开浮层。 */
  dismissOnAncestorScroll?: boolean;
  enableFlip?: boolean;
  /** 将浮层最大高度限制在锚点当前方向的可用视口内，由内容区负责滚动。 */
  constrainToAvailableHeight?: boolean;
};

function Popover({
  children,
  render,
  open: passedOpen,
  placement,
  onOpenChange,
  className,
  offset: offsetNum = 10,
  motionProps,
  trigger = 'click',
  dismissOnAncestorScroll = true,
  enableFlip = true,
  constrainToAvailableHeight = false,
}: React.PropsWithChildren<PopoverProps>) {
  // Use useControlledState for open/close state management
  const [isOpen, setIsOpen] = useControlledState({
    value: passedOpen,
    defaultValue: false,
    onChange: onOpenChange,
  });

  // Use useFloatingUI for positioning logic
  const { refs, floatingStyles, context } = useFloatingUI({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    offset: offsetNum,
    transform: false,
    enableFlip,
    constrainToAvailableHeight,
  });

  // Configure interaction hooks based on trigger type
  const hover = useHover(context, {
    enabled: trigger === 'hover',
    delay: { open: 0, close: animation.duration.fast },
  });
  const click = useClick(context, {
    enabled: trigger === 'click',
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    click,
    useDismiss(context, { ancestorScroll: dismissOnAncestorScroll }),
    useRole(context),
  ]);

  return (
    <>
      {cloneElement(children, getReferenceProps({ ref: refs.setReference, ...children.props }))}
      <AnimatePresence>
        {isOpen && (
          <FloatingPortal>
            <FloatingFocusManager context={context} modal={false}>
              <motion.div
                className={cn('z-30 rounded-ss-2xl rounded-ee-2xl bg-black/30 backdrop-blur-sm', className)}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1, originY: 0 }}
                exit={{ opacity: 0, scale: 0.85, pointerEvents: 'none' }}
                transition={animation.spring.popoverContent}
                style={{ ...floatingStyles }}
                {...motionProps}
                {...getFloatingProps({ ref: refs.setFloating })}
              >
                {render({ close: () => setIsOpen(false) })}
              </motion.div>
            </FloatingFocusManager>
          </FloatingPortal>
        )}
      </AnimatePresence>
    </>
  );
}

export default React.memo(Popover);
